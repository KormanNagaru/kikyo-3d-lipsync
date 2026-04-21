$port = 8080
$root = $PSScriptRoot
$url = "http://localhost:$port/"

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($url)
$listener.Start()

Write-Host "Serving at $url" -ForegroundColor Green
Write-Host "Open in browser: $url" -ForegroundColor Cyan
Write-Host "Press Ctrl+C to stop." -ForegroundColor Yellow

$mimeTypes = @{
    ".html"  = "text/html; charset=utf-8"
    ".js"    = "application/javascript"
    ".css"   = "text/css"
    ".glb"   = "model/gltf-binary"
    ".gltf"  = "model/gltf+json"
    ".jpeg"  = "image/jpeg"
    ".jpg"   = "image/jpeg"
    ".png"   = "image/png"
    ".ico"   = "image/x-icon"
}

try {
    while ($listener.IsListening) {
        $ctx = $listener.GetContext()
        $req = $ctx.Request
        $res = $ctx.Response

        $localPath = $req.Url.LocalPath -replace '/', '\'
        if ($localPath -eq '\') { $localPath = '\index.html' }

        $filePath = Join-Path $root $localPath.TrimStart('\')

        if (Test-Path $filePath -PathType Leaf) {
            $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
            $mime = if ($mimeTypes[$ext]) { $mimeTypes[$ext] } else { "application/octet-stream" }
            $bytes = [System.IO.File]::ReadAllBytes($filePath)
            $res.ContentType = $mime
            $res.ContentLength64 = $bytes.Length
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
            Write-Host "200 $($req.Url.LocalPath)"
        } else {
            $res.StatusCode = 404
            $msg = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
            $res.OutputStream.Write($msg, 0, $msg.Length)
            Write-Host "404 $($req.Url.LocalPath)" -ForegroundColor Red
        }

        $res.OutputStream.Close()
    }
} finally {
    $listener.Stop()
}
