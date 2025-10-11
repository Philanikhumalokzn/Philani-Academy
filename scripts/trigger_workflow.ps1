<#
Trigger the GitHub Actions workflow 'prisma-migrate-deploy.yml' for a branch.

Usage (PowerShell):
  1) Open a PowerShell terminal in the repo folder (C:\workspace\philani-academy).
  2) Run: .\scripts\trigger_workflow.ps1

You will be prompted for a GitHub Personal Access Token (PAT). The script does not store the token.
The PAT must have `repo` scope for private repositories (or appropriate workflow permissions).
#>

param(
    [string]$Owner = 'philanikhumalokzn',
    [string]$Repo = 'philani-academy',
    [string]$WorkflowFile = 'prisma-migrate-deploy.yml',
    [string]$Ref = 'feat/plans-ui-5d17577'
)

try {
    Write-Host "This will trigger workflow $WorkflowFile on branch $Ref for $Owner/$Repo"
    $secureToken = Read-Host -Prompt 'Enter GitHub Personal Access Token (PAT)' -AsSecureString
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
    $token = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)

    # Sanitize token: remove control characters (newlines, tabs) that may be pasted accidentally
    if ($token) {
        $token = $token.Trim()
        $token = $token -replace '[\x00-\x1F\x7F]', ''
    }
    if ([string]::IsNullOrWhiteSpace($token)) {
        throw "Token is empty after sanitization. Please paste a valid GitHub PAT."
    }

    $uri = "https://api.github.com/repos/$Owner/$Repo/actions/workflows/$WorkflowFile/dispatches"
    $body = @{ ref = $Ref } | ConvertTo-Json

    Write-Host "Sending dispatch request to GitHub..."
    Invoke-RestMethod -Method Post -Uri $uri -Headers @{
        Authorization = "Bearer $token"
        Accept = 'application/vnd.github+json'
        'User-Agent' = 'philani-academy-trigger-script'
    } -Body $body -ContentType 'application/json' -ErrorAction Stop

    Write-Host "Workflow dispatch request sent. Check Actions page in GitHub for the run."
}
catch {
    Write-Error "Failed to trigger workflow: $($_.Exception.Message)"
}
finally {
    if ($bstr) { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
    if ($secureToken) { $secureToken.Dispose() }
}
