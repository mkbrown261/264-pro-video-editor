#!/bin/bash
set -e
cd /home/work/264-pro-video-editor
claude --permission-mode bypassPermissions --print "$(cat /home/work/264-pro-video-editor/scripts/audit-fixes-prompt.txt)"
