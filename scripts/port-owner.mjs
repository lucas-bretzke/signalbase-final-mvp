import { execFileSync } from 'node:child_process';

export function describePortOwner(port) {
  const safePort = Number(port);
  if (!Number.isInteger(safePort) || safePort < 1) return 'processo desconhecido';
  try {
    if (process.platform === 'win32') {
      const script = [
        `$connection = Get-NetTCPConnection -State Listen -LocalPort ${safePort} -ErrorAction SilentlyContinue | Select-Object -First 1`,
        'if (-not $connection) { exit 0 }',
        '$process = Get-Process -Id $connection.OwningProcess -ErrorAction SilentlyContinue',
        'Write-Output ("PID {0} ({1})" -f $connection.OwningProcess, $process.ProcessName)',
      ].join('; ');
      return execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8', timeout: 3000 }).trim() || 'processo desconhecido';
    }
    return execFileSync('sh', ['-c', `lsof -nP -iTCP:${safePort} -sTCP:LISTEN -t 2>/dev/null | head -n 1`], { encoding: 'utf8', timeout: 3000 }).trim() || 'processo desconhecido';
  } catch {
    return 'processo desconhecido';
  }
}
