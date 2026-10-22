# PowerShell script to install newly added dependencies and clean obsolete packages
Write-Host "Installing added dependencies..." -ForegroundColor Cyan

if (Get-Command pnpm -ErrorAction SilentlyContinue) {
    pnpm add temporal-polyfill helmet express-rate-limit
    pnpm remove @prisma/client
} elseif (Get-Command npm -ErrorAction SilentlyContinue) {
    npm install temporal-polyfill helmet express-rate-limit
    npm uninstall @prisma/client
} elseif (Get-Command yarn -ErrorAction SilentlyContinue) {
    yarn add temporal-polyfill helmet express-rate-limit
    yarn remove @prisma/client
} else {
    Write-Error "No package manager (pnpm, npm, yarn) found in PATH."
    exit 1
}

Write-Host "Dependencies successfully updated." -ForegroundColor Green
