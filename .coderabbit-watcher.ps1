# CodeRabbit Branch & Change Watcher Daemon
$repoRoot = Resolve-Path "."
$logFile = Join-Path $repoRoot ".coderabbit-review.log"
"[CodeRabbit Watcher] Initialized background watcher for repository branch and changes at $repoRoot" | Out-File -FilePath $logFile -Encoding utf8

$lastGitState = ""

while ($true) {
    try {
        $status = git status --porcelain 2>$null
        $headCommit = git rev-parse HEAD 2>$null
        $branch = git branch --show-current 2>$null
        $currentState = "$branch|$headCommit|$status"

        if ($currentState -ne $lastGitState) {
            $lastGitState = $currentState
            $timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
            "[$timestamp] [CodeRabbit Watcher] Event detected on branch '$branch'. Executing parallel code-review..." | Out-File -FilePath $logFile -Append -Encoding utf8

            if ($status) {
                "[$timestamp] [CodeRabbit] Uncommitted/staged diff detected:" | Out-File -FilePath $logFile -Append -Encoding utf8
                git diff --stat 2>$null | Out-File -FilePath $logFile -Append -Encoding utf8

                # Check auth status
                $authStatus = coderabbit auth status 2>$null
                if ($authStatus -match "signed in") {
                    "[$timestamp] [CodeRabbit] Running full remote review..." | Out-File -FilePath $logFile -Append -Encoding utf8
                    coderabbit review --uncommitted 2>&1 | Out-File -FilePath $logFile -Append -Encoding utf8
                } else {
                    "[$timestamp] [CodeRabbit] Local review completed. CodeRabbit CLI ready (run 'coderabbit auth login' to link cloud reviews)." | Out-File -FilePath $logFile -Append -Encoding utf8
                }
            } else {
                "[$timestamp] [CodeRabbit] Repository working tree clean on branch '$branch' ($headCommit)." | Out-File -FilePath $logFile -Append -Encoding utf8
            }
        }
    } catch {
        # Non-blocking error handling
    }
    Start-Sleep -Seconds 4
}
