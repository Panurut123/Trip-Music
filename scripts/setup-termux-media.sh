#!/usr/bin/env bash
set -euo pipefail
pkg update
pkg install -y python python-pip ffmpeg
python -m pip install -U "yt-dlp[default]"
echo "Media tools ready:"
yt-dlp --version
ffmpeg -version | head -n 1
