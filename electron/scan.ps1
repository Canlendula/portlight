$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$warnings = [System.Collections.Generic.List[string]]::new()
$endpoints = @()
$fallbackNetstat = $null
try {
  $endpoints += @(Get-NetTCPConnection -State Listen -ErrorAction Stop | ForEach-Object {
    @{ protocol = 'TCP'; address = $_.LocalAddress; port = [int]$_.LocalPort; pid = [int]$_.OwningProcess }
  })
  $endpoints += @(Get-NetUDPEndpoint -ErrorAction Stop | ForEach-Object {
    @{ protocol = 'UDP'; address = $_.LocalAddress; port = [int]$_.LocalPort; pid = [int]$_.OwningProcess }
  })
} catch {
  $fallbackNetstat = (& "$env:SystemRoot\System32\netstat.exe" -ano | Out-String)
  if ($LASTEXITCODE -ne 0) { throw 'Unable to read Windows listening ports.' }
  $warnings.Add('NETWORK_FALLBACK')
}
try {
  $processes = @(Get-CimInstance Win32_Process -ErrorAction Stop | ForEach-Object {
    @{
      pid = [int]$_.ProcessId; parentPid = [int]$_.ParentProcessId; name = $_.Name
      commandLine = $_.CommandLine; executablePath = $_.ExecutablePath
      startedAt = $(if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString('o') } else { $null })
      memoryMB = [math]::Round([double]$_.WorkingSetSize / 1MB, 1)
    }
  })
} catch {
  $warnings.Add('PROCESS_METADATA_UNAVAILABLE')
  $processes = @(Get-Process | ForEach-Object {
    $start = $null; $exe = $null
    try { $start = $_.StartTime.ToUniversalTime().ToString('o'); $exe = $_.Path } catch {}
    @{ pid = $_.Id; parentPid = 0; name = ($_.ProcessName + '.exe'); commandLine = $null; executablePath = $exe; startedAt = $start; memoryMB = [math]::Round($_.WorkingSet64 / 1MB, 1) }
  })
}
@{ endpoints = @($endpoints); processes = @($processes); warnings = @($warnings); fallbackNetstat = $fallbackNetstat } | ConvertTo-Json -Depth 5 -Compress
