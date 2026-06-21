import CoreGraphics
import Foundation

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

let args = CommandLine.arguments
guard args.count >= 2 else {
    fail("usage: window_event.swift click <x> <y> | hotkey <keyCode>")
}

let source = CGEventSource(stateID: .hidSystemState)

switch args[1] {
case "click":
    guard args.count == 4, let x = Double(args[2]), let y = Double(args[3]) else {
        fail("usage: window_event.swift click <x> <y>")
    }
    let point = CGPoint(x: x, y: y)
    CGEvent(mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
    usleep(80_000)
    CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
case "hotkey":
    guard args.count == 3, let keyCode = UInt16(args[2]) else {
        fail("usage: window_event.swift hotkey <keyCode>")
    }
    let down = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: true)
    down?.flags = .maskCommand
    down?.post(tap: .cghidEventTap)
    usleep(40_000)
    let up = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: false)
    up?.flags = .maskCommand
    up?.post(tap: .cghidEventTap)
default:
    fail("unknown command: \(args[1])")
}
