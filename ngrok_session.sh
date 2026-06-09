#!/bin/bash
# ngrok_session.sh
# ================
# Starts ngrok, grabs the public URL, and prints the Render env var command.
# Run this BEFORE an annotation session when using deployed mode.
#
# Usage:
#   chmod +x ngrok_session.sh
#   ./ngrok_session.sh

set -e

echo "Starting Flask image server on port 5000..."
# Flask must already be running, or start it in background:
# IMAGES_ROOT=/path/to/image-extraction python app.py &

echo "Starting ngrok tunnel on port 5000..."
ngrok http 5000 --log=stdout &
NGROK_PID=$!

# Wait for ngrok to initialize
sleep 3

# Get the public URL from ngrok's local API
NGROK_URL=$(curl -s http://localhost:4040/api/tunnels \
  | python3 -c "import sys,json; tunnels=json.load(sys.stdin)['tunnels']; print(next(t['public_url'] for t in tunnels if t['proto']=='https'))" 2>/dev/null)

if [ -z "$NGROK_URL" ]; then
  echo "Could not get ngrok URL. Check ngrok is running: http://localhost:4040"
  kill $NGROK_PID 2>/dev/null
  exit 1
fi

echo ""
echo "========================================"
echo "  ngrok URL: $NGROK_URL"
echo "========================================"
echo ""
echo "Now go to Render dashboard and set:"
echo "  IMAGES_ROOT = $NGROK_URL"
echo ""
echo "Or update render.yaml and redeploy:"
echo "  value: \"$NGROK_URL\""
echo ""
echo "Annotators can reach images at:"
echo "  $NGROK_URL/imgs/Inseguros-Barranco-GGZ-2016/..."
echo ""
echo "Press Ctrl+C to stop ngrok when session is done."
wait $NGROK_PID