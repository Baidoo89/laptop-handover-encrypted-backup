param([string]$Destination = (Join-Path (Get-Location).Path ('Restored-Projects-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss'))))
$ErrorActionPreference = 'Stop'
$securePassword = Read-Host 'Enter your saved backup password' -AsSecureString
$passwordPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
    $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPtr)
    $processInfo = New-Object Diagnostics.ProcessStartInfo
    $processInfo.FileName = (Get-Command node.exe).Source
    $processInfo.Arguments = '"' + (Join-Path $PSScriptRoot 'backup-crypto.mjs') + '"'
    $processInfo.UseShellExecute = $false
    $processInfo.CreateNoWindow = $true
    $processInfo.RedirectStandardInput = $true
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $processInfo
    $null = $process.Start()
    $request = @{action='restore';directory=$PSScriptRoot;destination=[IO.Path]::GetFullPath($Destination);password=$password} | ConvertTo-Json -Compress
    $process.StandardInput.Write($request)
    $process.StandardInput.Close()
    $request = $null
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) { throw 'Restore did not complete. Check your password and the backup files.' }
    Write-Host 'Backup restored into the new directory.' -ForegroundColor Green
} finally {
    $request = $null; $password = $null
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPtr)
    $securePassword.Dispose()
}
