const std = @import("std");
const assert = std.debug.assert;
const builtin = @import("builtin");
const lib_alloc = @import("../../lib/allocator.zig");
const CAllocator = lib_alloc.Allocator;
const Terminal = @import("../Terminal.zig");
const stream = @import("../stream.zig");
const Result = @import("result.zig").Result;
const Page = @import("../page.zig").Page;
const Cell = @import("../page.zig").Cell;
const color = @import("../color.zig");

const log = std.log.scoped(.terminal_c);

/// Custom handler for capturing title changes
const TitleTrackingHandler = struct {
    terminal: *Terminal,
    title: []u8,
    title_len: usize,
    alloc: std.mem.Allocator,

    fn init(alloc: std.mem.Allocator, terminal: *Terminal) !TitleTrackingHandler {
        const title_buf = try alloc.alloc(u8, 256); // Initial buffer size
        return .{
            .terminal = terminal,
            .title = title_buf,
            .title_len = 0,
            .alloc = alloc,
        };
    }

    pub fn deinit(self: *TitleTrackingHandler) void {
        self.alloc.free(self.title);
    }

    pub fn vt(
        self: *TitleTrackingHandler,
        comptime action: stream.Action.Tag,
        value: stream.Action.Value(action),
    ) !void {
        // Forward all events to the terminal's handler
        var handler = self.terminal.vtHandler();
        try handler.vt(action, value);

        // Also capture title changes
        if (action == .window_title) {
            const title = value.title;
            if (title.len > self.title.len) {
                self.alloc.free(self.title);
                self.title = try self.alloc.alloc(u8, title.len);
            }
            @memcpy(self.title[0..title.len], title);
            self.title_len = title.len;
        }
    }
};

const TitleTrackingStream = stream.Stream(TitleTrackingHandler);

/// Wrapper around Terminal that tracks allocator for C API usage.
const TerminalWrapper = struct {
    terminal: Terminal,
    stream: TitleTrackingStream,
    alloc: std.mem.Allocator,
};

/// C: GhosttyTerminal
pub const CTerminal = ?*TerminalWrapper;

/// Create a new terminal instance.
pub fn new(
    alloc_: ?*const CAllocator,
    cols: u16,
    rows: u16,
    result: *CTerminal,
) callconv(.c) Result {
    const alloc = lib_alloc.default(alloc_);
    const ptr = alloc.create(TerminalWrapper) catch
        return .out_of_memory;

    ptr.terminal = Terminal.init(alloc, .{
        .cols = cols,
        .rows = rows,
    }) catch {
        alloc.destroy(ptr);
        return .out_of_memory;
    };

    const handler = TitleTrackingHandler.init(alloc, &ptr.terminal) catch {
        ptr.terminal.deinit(alloc);
        alloc.destroy(ptr);
        return .out_of_memory;
    };

    ptr.stream = TitleTrackingStream.initAlloc(alloc, handler);
    ptr.alloc = alloc;
    result.* = ptr;
    return .success;
}

/// Free a terminal instance.
pub fn free(terminal_: CTerminal) callconv(.c) void {
    const wrapper = terminal_ orelse return;
    const alloc = wrapper.alloc;
    wrapper.stream.deinit();
    wrapper.terminal.deinit(alloc);
    alloc.destroy(wrapper);
}

/// Feed data to the terminal parser.
pub fn write(
    terminal_: CTerminal,
    data: [*]const u8,
    len: usize,
) callconv(.c) Result {
    const wrapper = terminal_ orelse return .invalid_value;
    const slice = data[0..len];
    wrapper.stream.nextSlice(slice) catch return .out_of_memory;
    return .success;
}

/// Get the terminal screen dimensions.
pub fn getSize(
    terminal_: CTerminal,
    cols: *u16,
    rows: *u16,
) callconv(.c) void {
    const wrapper = terminal_ orelse return;
    cols.* = wrapper.terminal.cols;
    rows.* = wrapper.terminal.rows;
}

/// Get cursor position.
pub fn getCursor(
    terminal_: CTerminal,
    x: *u16,
    y: *u16,
) callconv(.c) void {
    const wrapper = terminal_ orelse return;
    const screen = wrapper.terminal.screen;
    x.* = @intCast(screen.cursor.x);
    y.* = @intCast(screen.cursor.y);
}

/// Get a cell at a specific position in active area coordinates.
/// x and y are relative to the active area (0,0 is top-left of active area).
/// The active area is where the cursor lives and where programs can write.
/// Returns false if position is out of bounds.
pub fn getCell(
    terminal_: CTerminal,
    x: u16,
    y: u16,
    codepoint: *u32,
    fg_r: *u8,
    fg_g: *u8,
    fg_b: *u8,
    bg_r: *u8,
    bg_g: *u8,
    bg_b: *u8,
    bold: *bool,
    italic: *bool,
    underline: *bool,
) callconv(.c) bool {
    const wrapper = terminal_ orelse return false;
    const screen = &wrapper.terminal.screen;

    if (y >= wrapper.terminal.rows or x >= wrapper.terminal.cols) {
        return false;
    }

    const pin = screen.pages.pin(.{ .active = .{ .x = x, .y = y } }) orelse return false;

    const rac = pin.rowAndCell();
    const cell = rac.cell;

    // Get codepoint based on content tag
    codepoint.* = switch (cell.content_tag) {
        .codepoint, .codepoint_grapheme => cell.content.codepoint,
        else => 0,
    };

    // Get style from pin
    const cell_style = pin.style(cell);

    // Get color palette
    const palette = &wrapper.terminal.colors.palette.current;

    // Get default colors (fallback to white on black if not set)
    const default_fg = wrapper.terminal.colors.foreground.get() orelse color.RGB{ .r = 255, .g = 255, .b = 255 };
    const default_bg = wrapper.terminal.colors.background.get() orelse color.RGB{ .r = 0, .g = 0, .b = 0 };

    // Get foreground color
    const fg_color = cell_style.fg(.{
        .default = default_fg,
        .palette = palette,
        .bold = null,
    });
    fg_r.* = fg_color.r;
    fg_g.* = fg_color.g;
    fg_b.* = fg_color.b;

    // Get background color
    const bg_color = cell_style.bg(cell, palette) orelse default_bg;
    bg_r.* = bg_color.r;
    bg_g.* = bg_color.g;
    bg_b.* = bg_color.b;

    // Get styles
    bold.* = cell_style.flags.bold;
    italic.* = cell_style.flags.italic;
    underline.* = cell_style.flags.underline != .none;

    return true;
}

/// Get a cell at a specific position in viewport coordinates.
/// x and y are relative to the current viewport (0,0 is top-left of visible area).
/// This respects the current scroll position.
/// Returns false if position is out of bounds.
pub fn getCellViewport(
    terminal_: CTerminal,
    x: u16,
    y: u16,
    codepoint: *u32,
    fg_r: *u8,
    fg_g: *u8,
    fg_b: *u8,
    bg_r: *u8,
    bg_g: *u8,
    bg_b: *u8,
    bold: *bool,
    italic: *bool,
    underline: *bool,
) callconv(.c) bool {
    const wrapper = terminal_ orelse return false;
    const screen = &wrapper.terminal.screen;

    if (y >= wrapper.terminal.rows or x >= wrapper.terminal.cols) {
        return false;
    }

    const pin = screen.pages.pin(.{ .viewport = .{ .x = x, .y = y } }) orelse return false;

    const rac = pin.rowAndCell();
    const cell = rac.cell;

    // Get codepoint based on content tag
    codepoint.* = switch (cell.content_tag) {
        .codepoint, .codepoint_grapheme => cell.content.codepoint,
        else => 0,
    };

    // Get style from pin
    const cell_style = pin.style(cell);

    // Get color palette
    const palette = &wrapper.terminal.colors.palette.current;

    // Get default colors (fallback to white on black if not set)
    const default_fg = wrapper.terminal.colors.foreground.get() orelse color.RGB{ .r = 255, .g = 255, .b = 255 };
    const default_bg = wrapper.terminal.colors.background.get() orelse color.RGB{ .r = 0, .g = 0, .b = 0 };

    // Get foreground color
    const fg_color = cell_style.fg(.{
        .default = default_fg,
        .palette = palette,
        .bold = null,
    });
    fg_r.* = fg_color.r;
    fg_g.* = fg_color.g;
    fg_b.* = fg_color.b;

    // Get background color
    const bg_color = cell_style.bg(cell, palette) orelse default_bg;
    bg_r.* = bg_color.r;
    bg_g.* = bg_color.g;
    bg_b.* = bg_color.b;

    // Get styles
    bold.* = cell_style.flags.bold;
    italic.* = cell_style.flags.italic;
    underline.* = cell_style.flags.underline != .none;

    return true;
}

/// Clear the terminal screen.
pub fn clear(terminal_: CTerminal) callconv(.c) void {
    const wrapper = terminal_ orelse return;
    // Send clear screen sequence
    wrapper.stream.nextSlice("\x1b[2J") catch {};
    wrapper.stream.nextSlice("\x1b[H") catch {};
}

/// Reset the terminal to initial state.
pub fn reset(terminal_: CTerminal) callconv(.c) void {
    const wrapper = terminal_ orelse return;
    // Send RIS (Reset to Initial State) sequence
    wrapper.stream.nextSlice("\x1bc") catch {};
}

/// Resize the terminal to new dimensions.
pub fn resize(
    terminal_: CTerminal,
    cols: u16,
    rows: u16,
) callconv(.c) Result {
    const wrapper = terminal_ orelse return .invalid_value;
    wrapper.terminal.resize(wrapper.alloc, cols, rows) catch return .out_of_memory;
    return .success;
}

/// Get the current window title.
/// Returns a pointer to the title string and its length.
/// The pointer is valid until the next call to write() or free().
pub fn getTitle(
    terminal_: CTerminal,
    title_ptr: *[*]const u8,
    title_len: *usize,
) callconv(.c) void {
    const wrapper = terminal_ orelse {
        title_ptr.* = "";
        title_len.* = 0;
        return;
    };

    title_ptr.* = wrapper.stream.handler.title.ptr;
    title_len.* = wrapper.stream.handler.title_len;
}

/// Get scrollback information.
/// Returns the total number of rows (including scrollback and visible rows),
/// the current viewport offset, and the number of visible rows.
pub fn getScrollback(
    terminal_: CTerminal,
    total_rows: *usize,
    viewport_offset: *usize,
    visible_rows: *usize,
) callconv(.c) void {
    const wrapper = terminal_ orelse {
        total_rows.* = 0;
        viewport_offset.* = 0;
        visible_rows.* = 0;
        return;
    };

    const screen = &wrapper.terminal.screen;
    const sb = screen.pages.scrollbar();
    total_rows.* = sb.total;
    viewport_offset.* = sb.offset;
    visible_rows.* = sb.len;
}

/// Set the viewport offset for scrolling.
/// offset is the number of rows from the top of the scrollback buffer.
/// Returns success if the viewport was updated.
pub fn setViewportOffset(
    terminal_: CTerminal,
    offset: usize,
) callconv(.c) Result {
    const wrapper = terminal_ orelse return .invalid_value;
    const screen = &wrapper.terminal.screen;

    // Use the PageList scroll function to set viewport to the row offset
    screen.pages.scroll(.{ .row = offset });

    return .success;
}

/// Get all cells in the viewport at once.
/// Writes cell data to the provided buffer in row-major order (left-to-right, top-to-bottom).
/// Each cell is 14 bytes: codepoint (u32), fg_r (u8), fg_g (u8), fg_b (u8),
/// bg_r (u8), bg_g (u8), bg_b (u8), bold (u8), italic (u8), underline (u8), padding (u8).
/// buffer must be at least cols * rows * 14 bytes.
/// Returns false if buffer is null or terminal is invalid.
pub fn getAllCellsViewport(
    terminal_: CTerminal,
    buffer: [*]u8,
) callconv(.c) bool {
    const wrapper = terminal_ orelse return false;
    const screen = &wrapper.terminal.screen;
    const cols = wrapper.terminal.cols;
    const rows = wrapper.terminal.rows;

    // Get color palette
    const palette = &wrapper.terminal.colors.palette.current;

    // Get default colors (fallback to white on black if not set)
    const default_fg = wrapper.terminal.colors.foreground.get() orelse color.RGB{ .r = 255, .g = 255, .b = 255 };
    const default_bg = wrapper.terminal.colors.background.get() orelse color.RGB{ .r = 0, .g = 0, .b = 0 };

    var offset: usize = 0;
    const cell_size = 14;

    for (0..rows) |y| {
        for (0..cols) |x| {
            const pin = screen.pages.pin(.{ .viewport = .{ .x = @intCast(x), .y = @intCast(y) } }) orelse {
                // Out of bounds cell - write zeros
                @memset(buffer[offset..offset + cell_size], 0);
                offset += cell_size;
                continue;
            };

            const rac = pin.rowAndCell();
            const cell = rac.cell;

            // Get codepoint based on content tag
            const codepoint_val: u32 = switch (cell.content_tag) {
                .codepoint, .codepoint_grapheme => cell.content.codepoint,
                else => 0,
            };

            // Get style from pin
            const cell_style = pin.style(cell);

            // Get foreground color
            const fg_color = cell_style.fg(.{
                .default = default_fg,
                .palette = palette,
                .bold = null,
            });

            // Get background color
            const bg_color = cell_style.bg(cell, palette) orelse default_bg;

            // Write cell data to buffer
            const cell_ptr = @as(*[14]u8, @ptrCast(buffer + offset));
            // Write codepoint as u32 (little-endian)
            std.mem.writeInt(u32, cell_ptr[0..4], codepoint_val, .little);
            cell_ptr[4] = fg_color.r;
            cell_ptr[5] = fg_color.g;
            cell_ptr[6] = fg_color.b;
            cell_ptr[7] = bg_color.r;
            cell_ptr[8] = bg_color.g;
            cell_ptr[9] = bg_color.b;
            cell_ptr[10] = if (cell_style.flags.bold) 1 else 0;
            cell_ptr[11] = if (cell_style.flags.italic) 1 else 0;
            cell_ptr[12] = if (cell_style.flags.underline != .none) 1 else 0;
            cell_ptr[13] = 0; // padding

            offset += cell_size;
        }
    }

    return true;
}
