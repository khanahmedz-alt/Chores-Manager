#!/usr/bin/env sh
# Wraps src/app.html in a full HTML document so it can be opened directly in a browser
# or hosted as a static site (data is then saved in that browser only).
set -e
cd "$(dirname "$0")/.."
{
  printf '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
  printf '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
  printf '<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%%}[hidden]{display:none!important}</style>\n'
  printf '</head>\n<body>\n'
  cat src/app.html
  printf '\n</body>\n</html>\n'
} > index.html
echo "Built index.html"
