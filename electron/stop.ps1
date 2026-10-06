param([int]$TargetPid, [string]$ExpectedStart, [int]$ExpectedPort, [ValidateSet('TCP','UDP')][string]$Protocol, [switch]$IncludeChildren)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$held = [System.Collections.Generic.List[System.Diagnostics.Process]]::new()
function Assert-SafeProcess($process) {
  if ($process.Id -le 4 -or $process.ProcessName -match '^(System|Registry|Secure System|Memory Compression|smss|csrss|wininit|winlogon|services|lsass|svchost|dwm|explorer|fontdrvhost|sihost)$') { throw 'Protected Windows process.' }
  $path = $process.MainModule.FileName
  if ($path.StartsWith($env:SystemRoot + '\', [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Protected Windows process.' }
}
try {
  $root = [System.Diagnostics.Process]::GetProcessById($TargetPid)
  $null = $root.Handle
  $held.Add($root)
  # CIM truncates creation timestamps to microseconds; process handles retain 100ns precision.
  if ($root.StartTime.ToUniversalTime().ToString('yyyyMMddHHmmssffffff') -ne [DateTime]::Parse($ExpectedStart).ToUniversalTime().ToString('yyyyMMddHHmmssffffff')) { throw 'Process identity changed. Refresh before stopping.' }
  Assert-SafeProcess $root
  $bindings = if ($Protocol -eq 'TCP') { @(Get-NetTCPConnection -State Listen -OwningProcess $TargetPid) } else { @(Get-NetUDPEndpoint -OwningProcess $TargetPid) }
  if (-not ($bindings | Where-Object { $_.LocalPort -eq $ExpectedPort })) { throw 'Process no longer owns this port. Refresh before stopping.' }
  if ($IncludeChildren) {
    $all = @(Get-CimInstance Win32_Process)
    $queue = [System.Collections.Generic.Queue[int]]::new()
    $queue.Enqueue($TargetPid)
    $seen = [System.Collections.Generic.HashSet[int]]::new()
    $null = $seen.Add($TargetPid)
    while ($queue.Count -gt 0) {
      $parent = $queue.Dequeue()
      foreach ($child in ($all | Where-Object { $_.ParentProcessId -eq $parent })) {
        if (-not $seen.Add([int]$child.ProcessId)) { continue }
        $candidate = $null
        try { $candidate = [System.Diagnostics.Process]::GetProcessById([int]$child.ProcessId); $null = $candidate.Handle } catch { if ($candidate) { $candidate.Dispose() }; continue }
        if ($candidate.StartTime.ToUniversalTime().ToString('yyyyMMddHHmmssffffff') -ne $child.CreationDate.ToUniversalTime().ToString('yyyyMMddHHmmssffffff') -or $candidate.StartTime.ToUniversalTime() -lt $root.StartTime.ToUniversalTime()) { $candidate.Dispose(); continue }
        try { Assert-SafeProcess $candidate } catch { $candidate.Dispose(); throw }
        $held.Add($candidate)
        $queue.Enqueue([int]$child.ProcessId)
      }
    }
  }
  # Keep handles open during identity checks and termination to prevent PID reuse.
  for ($i = $held.Count - 1; $i -ge 0; $i--) {
    if (-not $held[$i].HasExited) { $held[$i].Kill(); $null = $held[$i].WaitForExit(3000) }
  }
  @{ ok = $true } | ConvertTo-Json -Compress
} finally { foreach ($process in $held) { $process.Dispose() } }
