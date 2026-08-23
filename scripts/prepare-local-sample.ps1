[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$PdfPath,

    [ValidateRange(1, 1000)]
    [int]$MaxQuestions = 50
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$workerRoot = Join-Path $projectRoot "worker"
$privateRoot = Join-Path $projectRoot "apps\web\data\private"
$candidatePath = Join-Path $privateRoot "question-candidates.json"

$resolvedPdf = (Resolve-Path -LiteralPath $PdfPath).Path
if ([IO.Path]::GetExtension($resolvedPdf) -ne ".pdf") {
    throw "Input must be a PDF file."
}

$bundledPython = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
$pythonExe = if (Test-Path -LiteralPath $bundledPython) {
    $bundledPython
} else {
    (Get-Command python -ErrorAction Stop).Source
}

$bundledPoppler = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\native\poppler\Library\bin\pdftoppm.exe"
$pdftoppmExe = if (Test-Path -LiteralPath $bundledPoppler) {
    $bundledPoppler
} else {
    (Get-Command pdftoppm -ErrorAction Stop).Source
}

New-Item -ItemType Directory -Force -Path $privateRoot | Out-Null

& $pythonExe -m pip install --disable-pip-version-check -e $workerRoot
if ($LASTEXITCODE -ne 0) { throw "Unable to install the PDF importer." }

& $pythonExe -m az_exam_importer.cli $resolvedPdf --output $candidatePath --max-questions $MaxQuestions
if ($LASTEXITCODE -ne 0) { throw "PDF extraction failed." }

$bundle = Get-Content -Raw -LiteralPath $candidatePath | ConvertFrom-Json
$lastPage = ($bundle.candidates.source_pages | ForEach-Object { $_ } | Measure-Object -Maximum).Maximum
if (-not $lastPage) { throw "No question pages were extracted." }
$documentId = $bundle.document.document_id
$pageRoot = Join-Path $privateRoot "documents\$documentId\pages"
New-Item -ItemType Directory -Force -Path $pageRoot | Out-Null

$resolvedPageRoot = (Resolve-Path -LiteralPath $pageRoot).Path
Get-ChildItem -LiteralPath $resolvedPageRoot -Filter "page-*.png" -File | Remove-Item -Force
$pagePrefix = Join-Path $resolvedPageRoot "page"
& $pdftoppmExe -f 1 -l $lastPage -r 96 -png $resolvedPdf $pagePrefix
if ($LASTEXITCODE -ne 0) { throw "PDF page rendering failed." }
Get-ChildItem -LiteralPath $resolvedPageRoot -Filter "page-*.png" -File | ForEach-Object {
    if ($_.BaseName -match '^page-(\d+)$') {
        $normalized = "page-{0:D4}.png" -f [int]$Matches[1]
        if ($_.Name -ne $normalized) { Rename-Item -LiteralPath $_.FullName -NewName $normalized }
    }
}

$pointerPath = Join-Path $privateRoot "active-import.json"
$pointerTemp = Join-Path $privateRoot "active-import.tmp"
$pointerJson = [ordered]@{ candidate_path = $candidatePath; document_id = $documentId } | ConvertTo-Json
[IO.File]::WriteAllText($pointerTemp, $pointerJson, (New-Object Text.UTF8Encoding($false)))
Move-Item -LiteralPath $pointerTemp -Destination $pointerPath -Force

[ordered]@{
    source = $resolvedPdf
    questions = $bundle.candidates.Count
    rendered_pages = $lastPage
    output = $candidatePath
} | ConvertTo-Json
