Add-Type -AssemblyName System.Drawing

$width = 1400
$height = 1500
$bitmap = New-Object System.Drawing.Bitmap $width, $height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

function Brush($hex) {
    return New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml($hex))
}

function Pen($hex, $size) {
    return New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml($hex)), $size
}

$bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Rectangle 0, 0, $width, $height),
    [System.Drawing.ColorTranslator]::FromHtml("#fff7ed"),
    [System.Drawing.ColorTranslator]::FromHtml("#d9f1e8"),
    45
)
$graphics.FillRectangle($bg, 0, 0, $width, $height)

$circleBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Rectangle 140, 140, 1120, 1120),
    [System.Drawing.ColorTranslator]::FromHtml("#ec8d78"),
    [System.Drawing.ColorTranslator]::FromHtml("#0f766e"),
    30
)
$graphics.FillEllipse($circleBrush, 120, 140, 1150, 1150)

$paperBrush = Brush "#fffaf2"
$shadowBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(38, 22, 18, 15))
$graphics.FillPie($shadowBrush, 250, 460, 900, 760, -8, 198)
$graphics.FillRectangle($paperBrush, 268, 430, 830, 720)

$linePen = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml("#d8c7b8"), 5)
for ($y = 520; $y -lt 1080; $y += 84) {
    $graphics.DrawLine($linePen, 340, $y, 1030, $y)
}

$wavePen = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml("#b94f37"), 12)
$points = New-Object System.Collections.Generic.List[System.Drawing.PointF]
for ($x = 330; $x -le 1010; $x += 12) {
    $angle = ($x - 330) / 46
    $y = 720 + [Math]::Sin($angle) * 52 + [Math]::Sin($angle * 2.1) * 24
    $points.Add((New-Object System.Drawing.PointF $x, $y))
}
$graphics.DrawCurve($wavePen, $points.ToArray())

$fontTitle = New-Object System.Drawing.Font "Georgia", 72, ([System.Drawing.FontStyle]::Bold)
$fontSmall = New-Object System.Drawing.Font "Arial", 30, ([System.Drawing.FontStyle]::Bold)
$graphics.DrawString("uma vida", $fontTitle, (Brush "#16120f"), 354, 590)
$graphics.DrawString("em forma de musica", $fontSmall, (Brush "#0f766e"), 360, 815)

$noteFont = New-Object System.Drawing.Font "Georgia", 160, ([System.Drawing.FontStyle]::Bold)
$graphics.DrawString(([char]0x266A).ToString(), $noteFont, (Brush "#f1b84b"), 900, 265)
$graphics.DrawString(([char]0x266B).ToString(), $noteFont, (Brush "#fffaf2"), 170, 900)
$graphics.DrawString(([char]0x266C).ToString(), $noteFont, (Brush "#16120f"), 1000, 1040)

$micPen = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml("#16120f"), 18)
$graphics.DrawEllipse($micPen, 588, 1050, 170, 220)
$graphics.DrawLine($micPen, 672, 1270, 672, 1390)
$graphics.DrawLine($micPen, 590, 1390, 760, 1390)
$graphics.FillEllipse((Brush "#fffaf2"), 620, 1082, 106, 150)
$graphics.DrawLine((New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml("#b94f37"), 9)), 637, 1140, 710, 1140)
$graphics.DrawLine((New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml("#b94f37"), 9)), 640, 1190, 705, 1190)

$bitmap.Save((Join-Path $PSScriptRoot "hero-song.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
