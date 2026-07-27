param(
  [Parameter(Mandatory = $true)]
  [string]$PrinterName
)

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class RawPrinterHelper {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFOA {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }

  [DllImport("winspool.Drv", EntryPoint="OpenPrinterW", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);

  [DllImport("winspool.Drv", SetLastError=true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint="StartDocPrinterW", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In] DOCINFOA di);

  [DllImport("winspool.Drv", SetLastError=true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", SetLastError=true)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", SetLastError=true)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", SetLastError=true)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

  public static bool SendBytesToPrinter(string szPrinterName, byte[] bytes, string jobName) {
    IntPtr hPrinter;
    DOCINFOA di = new DOCINFOA();
    di.pDocName = jobName;
    di.pDataType = "RAW";

    if (!OpenPrinter(szPrinterName, out hPrinter, IntPtr.Zero)) return false;
    try {
      if (!StartDocPrinter(hPrinter, 1, di)) return false;
      try {
        if (!StartPagePrinter(hPrinter)) return false;
        try {
          int dwWritten = 0;
          IntPtr pUnmanagedBytes = Marshal.AllocCoTaskMem(bytes.Length);
          Marshal.Copy(bytes, 0, pUnmanagedBytes, bytes.Length);
          bool ok = WritePrinter(hPrinter, pUnmanagedBytes, bytes.Length, out dwWritten);
          Marshal.FreeCoTaskMem(pUnmanagedBytes);
          return ok && dwWritten == bytes.Length;
        } finally { EndPagePrinter(hPrinter); }
      } finally { EndDocPrinter(hPrinter); }
    } finally { ClosePrinter(hPrinter); }
  }
}
"@

[Console]::Out.WriteLine('READY')
[Console]::Out.Flush()

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }

  $trimmed = $line.Trim()
  if ($trimmed -eq 'EXIT') { break }

  try {
    $payload = $trimmed | ConvertFrom-Json
    if ($payload.cmd -ne 'print') {
      [Console]::Out.WriteLine('ERR|invalid-cmd')
      [Console]::Out.Flush()
      continue
    }

    $filePath = [string]$payload.file
    $jobName = [string]$payload.job
    $targetPrinter = if ($payload.printer) { [string]$payload.printer } else { $PrinterName }

    if (-not (Get-Printer -Name $targetPrinter -ErrorAction SilentlyContinue)) {
      [Console]::Out.WriteLine("ERR|Printer not found: $targetPrinter")
      [Console]::Out.Flush()
      continue
    }

    if (-not (Test-Path -LiteralPath $filePath)) {
      [Console]::Out.WriteLine('ERR|missing-file')
      [Console]::Out.Flush()
      continue
    }

    $bytes = [System.IO.File]::ReadAllBytes($filePath)
    $ok = [RawPrinterHelper]::SendBytesToPrinter($targetPrinter, $bytes, $jobName)
    if ($ok) {
      [Console]::Out.WriteLine('OK')
    } else {
      [Console]::Out.WriteLine('ERR|write-failed')
    }
    [Console]::Out.Flush()
  } catch {
    [Console]::Out.WriteLine("ERR|$($_.Exception.Message)")
    [Console]::Out.Flush()
  }
}
