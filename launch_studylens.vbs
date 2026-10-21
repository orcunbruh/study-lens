Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

appDir = "C:\Users\Victus\.gemini\antigravity\scratch\study-lens"
url = "http://localhost:8095"

' 1. Sunucu çalışmıyorsa arka planda başlat
WshShell.Run "powershell -NoProfile -WindowStyle Hidden -Command ""$conn = Get-NetTCPConnection -LocalPort 8095 -State Listen -ErrorAction SilentlyContinue; if (-not $conn) { Start-Process pythonw -ArgumentList '""" & appDir & "\server.py""' -WorkingDirectory '""" & appDir & """' -WindowStyle Hidden; Start-Sleep -Milliseconds 900 }""", 0, True

' 2. Bağımsız uygulama penceresi (--app) olarak aç
chromePath1 = "C:\Program Files\Google\Chrome\Application\chrome.exe"
chromePath2 = "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
edgePath = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

If fso.FileExists(chromePath1) Then
    WshShell.Run """" & chromePath1 & """ --app=" & url, 1, False
ElseIf fso.FileExists(chromePath2) Then
    WshShell.Run """" & chromePath2 & """ --app=" & url, 1, False
ElseIf fso.FileExists(edgePath) Then
    WshShell.Run """" & edgePath & """ --app=" & url, 1, False
Else
    WshShell.Run url, 1, False
End If
