# Database setup script for Windows PowerShell

Write-Host "🚀 Setting up database for Club Operations..." -ForegroundColor Cyan

# Check if Docker is running
try {
    docker info | Out-Null
} catch {
    Write-Host "❌ Docker is not running. Please start Docker Desktop and try again." -ForegroundColor Red
    exit 1
}

# Start database
Write-Host "📦 Starting PostgreSQL container..." -ForegroundColor Yellow
docker compose up -d

# Wait for database to be ready
Write-Host "⏳ Waiting for database to be ready..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

# Check if database is ready
$maxAttempts = 30
$attempt = 0
while ($attempt -lt $maxAttempts) {
    try {
        docker compose exec -T postgres pg_isready -U clubops -d club_operations 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ Database is ready!" -ForegroundColor Green
            break
        }
    } catch {
        # Continue waiting
    }
    $attempt++
    Write-Host "  Attempt $attempt/$maxAttempts..." -ForegroundColor Gray
    Start-Sleep -Seconds 1
}

if ($attempt -eq $maxAttempts) {
    Write-Host "❌ Database failed to start after $maxAttempts attempts" -ForegroundColor Red
    exit 1
}

# Run migrations
Write-Host "📝 Running database migrations..." -ForegroundColor Yellow
pnpm db:migrate

Write-Host "✅ Database setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Database connection info:" -ForegroundColor Cyan
Write-Host "  Host: localhost"
Write-Host "  Port: 5432"
Write-Host "  Database: club_operations"
Write-Host "  User: clubops"
Write-Host "  Password: clubops_dev"
Write-Host ""
Write-Host "To stop the database: pnpm db:stop" -ForegroundColor Gray
Write-Host "To reset the database: pnpm db:reset" -ForegroundColor Gray








