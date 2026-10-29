#!/bin/bash
# Restart the test ComfyUI server, tracking it by PID file.
PIDF=/tmp/comfy.pid
if [ -f "$PIDF" ]; then kill "$(cat $PIDF)" 2>/dev/null; sleep 2; fi
cd /root/work/ComfyUI
SPLL_CIVITAI_API=http://127.0.0.1:8899/api/v1 SPLL_CIVITAI_DOWNLOAD=http://127.0.0.1:8899/api/download/models nohup /root/venv/bin/python main.py --cpu --listen 127.0.0.1 --port 8188 --disable-auto-launch > /tmp/comfy.log 2>&1 &
echo $! > "$PIDF"
for i in $(seq 1 40); do
  c=$(curl -s -o /dev/null -w "%{http_code}" 127.0.0.1:8188/spll/tree)
  [ "$c" = "200" ] && echo "up" && exit 0
  sleep 3
done
echo "not up"; tail -20 /tmp/comfy.log; exit 1
