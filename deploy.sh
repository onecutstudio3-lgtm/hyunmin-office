#!/bin/sh
# 사이트 배포: main(원본)을 push한 뒤 gh-pages(배포 브랜치)를 main에 맞춰 올린다.
#   GitHub Pages가 'gh-pages / (root)'로 설정되어 있어서 두 브랜치를 같이 올린다.
set -e
git push origin main
git branch -f gh-pages main
git push -f origin gh-pages
echo "배포 완료 → https://onecutstudio3-lgtm.github.io/hyunmin-office/"
