param([switch]$Remove, [switch]$WithHermes)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$names = @('DualLens - 翻译网关','DualLens - Hermes 免费代理')
if ($Remove) {
    foreach ($name in $names) {
        $existing = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
        if ($existing) {
            Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
            Unregister-ScheduledTask -TaskName $name -Confirm:$false
        }
    }
    Write-Output '已移除两个 DualLens 启动项'
    exit
}
$python = (Get-Command python.exe).Source
$pythonw = Join-Path (Split-Path -Parent $python) 'pythonw.exe'
if (-not (Test-Path -LiteralPath $pythonw)) { throw 'pythonw.exe 不存在' }
$account = "$env:USERDOMAIN\$env:USERNAME"
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $account
$principal = New-ScheduledTaskPrincipal -UserId $account -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -Hidden -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
$jobs = @(
    @{Name=$names[0]; Script=(Join-Path $projectRoot 'gateway\duallens_gateway.py'); Extra=' serve --port 18790'}
)
if ($WithHermes) {
    $jobs += @{Name=$names[1]; Script=(Join-Path $projectRoot 'gateway\run_hermes_proxy.py'); Extra=''}
}
foreach ($job in $jobs) {
    $action = New-ScheduledTaskAction -Execute $pythonw -Argument ('"' + $job.Script + '"' + $job.Extra) -WorkingDirectory $projectRoot
    Register-ScheduledTask -TaskName $job.Name -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'DualLens 用户已授权的登录启动项，仅回环监听，不自动发送微信消息。' -Force | Out-Null
    Start-ScheduledTask -TaskName $job.Name
}
Get-ScheduledTask -TaskName 'DualLens - *' | Select-Object TaskName,State
