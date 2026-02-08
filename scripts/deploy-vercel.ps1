# Helper script: prints the commands you'll need locally to migrate and seed a remote DB
# Usage: Edit the DATABASE_URL variable below, then run in PowerShell from the project root

$DATABASE_URL = Read-Host "Enter DATABASE_URL (postgres connection string)"
if (-not $DATABASE_URL) { Write-Host 'DATABASE_URL not provided, exiting'; exit 1 }

Write-Host "Run these commands in your project root (PowerShell):`n"
Write-Host "$env:DATABASE_URL = '$DATABASE_URL'"
Write-Host "npx prisma migrate deploy"
Write-Host "node scripts/create_admin.js"

Write-Host "\nThen push to GitHub and Vercel will build & deploy."