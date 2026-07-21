import AppKit
import UserNotifications

// launched by a notification click (no args): do nothing
let args = CommandLine.arguments
guard args.count > 1 else { exit(0) }
let title = args[1]
let body = args.count > 2 ? args[2] : ""

let center = UNUserNotificationCenter.current()

if title == "--status" {
    center.getNotificationSettings { s in
        print("auth=\(s.authorizationStatus.rawValue) alertStyle=\(s.alertStyle.rawValue) (auth: 0 notDetermined 1 denied 2 authorized; style: 0 none 1 banner 2 alert)")
        exit(0)
    }
    RunLoop.main.run()
}
center.requestAuthorization(options: [.alert, .sound]) { _, _ in
    let content = UNMutableNotificationContent()
    content.title = title
    if !body.isEmpty { content.body = body }
    content.sound = UNNotificationSound(named: UNNotificationSoundName("Glass.aiff"))
    let req = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
    center.add(req) { err in
        if let err = err { FileHandle.standardError.write(Data("\(err)\n".utf8)) }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { exit(err == nil ? 0 : 1) }
    }
}
RunLoop.main.run()
