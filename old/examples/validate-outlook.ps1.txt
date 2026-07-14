param(
    [Parameter(Mandatory = $true)]
    [string]$Path,

    [switch]$Display
)

$resolvedPath = (Resolve-Path $Path).Path

try {
    $outlook = New-Object -ComObject Outlook.Application
} catch {
    Write-Error 'Microsoft Outlook is not installed or its COM automation is unavailable.'
    exit 1
}

$namespace = $outlook.GetNamespace('MAPI')

try {
    $item = $namespace.OpenSharedItem($resolvedPath)
} catch {
    Write-Error "Outlook could not open: $resolvedPath"
    Write-Error $_
    if ($namespace -ne $null) {
        [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($namespace)
    }
    if ($outlook -ne $null) {
        [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($outlook)
    }
    exit 1
}

Write-Host "Opened in Outlook: $resolvedPath"
Write-Host "Message class: $($item.MessageClass)"
Write-Host "Subject: $($item.Subject)"
Write-Host "Attachments: $($item.Attachments.Count)"
Write-Host "Sender: $($item.SenderName)"

if ($Display) {
    $inspector = $item.GetInspector()
    $inspector.Display()
}

[void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($item)
[void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($namespace)
[void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($outlook)
[GC]::Collect()
[GC]::WaitForPendingFinalizers()

