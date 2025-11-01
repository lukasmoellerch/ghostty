const std = @import("std");
const color = @import("color.zig");

/// Configuration for bold text colors.
pub const BoldColor = union(enum) {
    color: color.RGB,
    bright,
};
