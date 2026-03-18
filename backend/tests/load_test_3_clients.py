#!/usr/bin/env python3
"""
Load test: 3 concurrent clients connecting to the pi-server backend.

Each client:
1. Logs in (gets access token)
2. Creates an agent session (or touches existing one)
3. Connects to the SSE stream
4. Sends a prompt
5. Waits for the response via SSE events

Usage:
  pip install requests sseclient-py
  python load_test_3_clients.py --url http://localhost:5454 --username admin --password <password>

Optional:
  --workspace-id <id>   workspace ID to use (must exist)
  --cwd <path>          working directory for agent sessions (default: ~)
  --prompt <text>       prompt to send (default: "What is 2+2?")
  --clients <n>         number of concurrent clients (default: 3)
"""

import argparse
import json
import sys
import threading
import time
from dataclasses import dataclass, field

import requests
import sseclient


@dataclass
class ClientResult:
    client_id: int
    login_time: float = 0.0
    session_create_time: float = 0.0
    stream_connect_time: float = 0.0
    prompt_send_time: float = 0.0
    first_event_time: float = 0.0
    total_time: float = 0.0
    events_received: int = 0
    error: str = ""
    stream_events: list = field(default_factory=list)


def login(base_url: str, username: str, password: str) -> dict:
    resp = requests.post(
        f"{base_url}/api/auth/login",
        json={"username": username, "password": password},
        timeout=10,
    )
    resp.raise_for_status()
    body = resp.json()
    if not body.get("success"):
        raise Exception(f"Login failed: {body.get('error')}")
    return body["data"]


def create_session(base_url: str, token: str, workspace_id: str, cwd: str) -> dict:
    resp = requests.post(
        f"{base_url}/api/agent/sessions",
        json={"workspace_id": workspace_id, "cwd": cwd},
        headers={"Authorization": f"Bearer {token}"},
        timeout=30,
    )
    resp.raise_for_status()
    body = resp.json()
    if not body.get("success"):
        raise Exception(f"Session create failed: {body.get('error')}")
    return body["data"]


def send_prompt(
    base_url: str,
    token: str,
    session_id: str,
    message: str,
    workspace_id: str = None,
    session_file: str = None,
) -> dict:
    payload = {"session_id": session_id, "message": message}
    if workspace_id:
        payload["workspace_id"] = workspace_id
    if session_file:
        payload["session_file"] = session_file
    resp = requests.post(
        f"{base_url}/api/agent/prompt",
        json=payload,
        headers={"Authorization": f"Bearer {token}"},
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()


def listen_stream(
    base_url: str,
    token: str,
    session_id: str,
    result: ClientResult,
    stop_event: threading.Event,
    from_id: int = 0,
):
    """Connect to SSE stream and collect events for this session."""
    url = f"{base_url}/api/stream?from={from_id}"
    try:
        resp = requests.get(
            url,
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "text/event-stream",
            },
            stream=True,
            timeout=120,
        )
        resp.raise_for_status()
        result.stream_connect_time = time.time()

        client = sseclient.SSEClient(resp)
        for event in client.events():
            if stop_event.is_set():
                break
            if not event.data:
                continue
            try:
                data = json.loads(event.data)
            except json.JSONDecodeError:
                continue

            # Only track events for our session
            evt_session = data.get("session_id", "")
            if evt_session != session_id:
                continue

            result.events_received += 1
            evt_type = data.get("event_type", data.get("type", ""))
            result.stream_events.append(
                {
                    "type": evt_type,
                    "id": data.get("id"),
                    "ts": time.time(),
                }
            )

            if result.events_received == 1:
                result.first_event_time = time.time()

            # Stop after turn_end or agent_end
            if evt_type in ("turn_end", "agent_end", "session_process_exited"):
                stop_event.set()
                break

    except Exception as e:
        if not stop_event.is_set():
            result.error = f"Stream error: {e}"


def run_client(
    client_id: int,
    base_url: str,
    username: str,
    password: str,
    workspace_id: str,
    cwd: str,
    prompt_text: str,
    barrier: threading.Barrier,
) -> ClientResult:
    result = ClientResult(client_id=client_id)
    start = time.time()

    try:
        # 1. Login
        t0 = time.time()
        auth = login(base_url, username, password)
        result.login_time = time.time() - t0
        token = auth["access_token"]
        print(f"[Client {client_id}] Logged in ({result.login_time:.3f}s)")

        # 2. Create session
        t0 = time.time()
        session = create_session(base_url, token, workspace_id, cwd)
        result.session_create_time = time.time() - t0
        session_id = session["session_id"]
        session_file = session.get("session_file", "")
        print(
            f"[Client {client_id}] Session created: {session_id[:12]}... ({result.session_create_time:.3f}s)"
        )

        # 3. Start SSE stream listener in background
        stop_event = threading.Event()
        stream_thread = threading.Thread(
            target=listen_stream,
            args=(base_url, token, session_id, result, stop_event),
            daemon=True,
        )
        stream_thread.start()
        time.sleep(0.5)  # give stream time to connect

        # 4. Wait for all clients to be ready, then send prompts simultaneously
        print(f"[Client {client_id}] Waiting at barrier...")
        barrier.wait(timeout=30)

        # 5. Send prompt
        t0 = time.time()
        prompt_resp = send_prompt(
            base_url, token, session_id, prompt_text, workspace_id, session_file
        )
        result.prompt_send_time = time.time() - t0
        print(
            f"[Client {client_id}] Prompt sent ({result.prompt_send_time:.3f}s) success={prompt_resp.get('success')}"
        )

        # 6. Wait for stream to finish (turn_end/agent_end) or timeout
        stream_thread.join(timeout=120)
        if stream_thread.is_alive():
            stop_event.set()
            stream_thread.join(timeout=5)
            result.error = "Stream timed out after 120s"

    except Exception as e:
        result.error = str(e)
        print(f"[Client {client_id}] ERROR: {e}")

    result.total_time = time.time() - start
    return result


def main():
    parser = argparse.ArgumentParser(description="Load test pi-server with concurrent clients")
    parser.add_argument("--url", default="http://localhost:5454", help="Base URL")
    parser.add_argument("--username", default="admin")
    parser.add_argument("--password", required=True)
    parser.add_argument("--workspace-id", default="test-workspace")
    parser.add_argument("--cwd", default="~")
    parser.add_argument("--prompt", default="What is 2+2? Reply in one word.")
    parser.add_argument("--clients", type=int, default=3)
    args = parser.parse_args()

    print(f"=== Load Test: {args.clients} concurrent clients ===")
    print(f"URL: {args.url}")
    print(f"Prompt: {args.prompt!r}")
    print()

    # Verify server is up
    try:
        resp = requests.get(f"{args.url}/healthz", timeout=5)
        resp.raise_for_status()
        print("Server is healthy.")
    except Exception as e:
        print(f"Server not reachable: {e}")
        sys.exit(1)

    # Create a workspace if needed (ignore errors if it already exists)
    try:
        auth = login(args.url, args.username, args.password)
        token = auth["access_token"]
        requests.post(
            f"{args.url}/api/workspaces",
            json={"name": args.workspace_id, "path": args.cwd},
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
    except Exception:
        pass

    barrier = threading.Barrier(args.clients, timeout=30)
    results: list[ClientResult] = [None] * args.clients
    threads = []

    overall_start = time.time()

    for i in range(args.clients):
        t = threading.Thread(
            target=lambda idx: results.__setitem__(
                idx,
                run_client(
                    idx,
                    args.url,
                    args.username,
                    args.password,
                    args.workspace_id,
                    args.cwd,
                    args.prompt,
                    barrier,
                ),
            ),
            args=(i,),
        )
        threads.append(t)
        t.start()

    for t in threads:
        t.join(timeout=180)

    overall_time = time.time() - overall_start

    # Print results
    print()
    print("=" * 70)
    print(f"{'RESULTS':^70}")
    print("=" * 70)
    print(
        f"{'Client':>8} {'Login':>8} {'Session':>9} {'Prompt':>8} {'1st Evt':>9} {'Total':>8} {'Events':>7} {'Error'}"
    )
    print("-" * 70)

    for r in results:
        if r is None:
            print("  (thread did not complete)")
            continue

        first_evt_latency = ""
        if r.first_event_time and r.stream_connect_time:
            first_evt_latency = f"{r.first_event_time - r.stream_connect_time:.3f}s"

        error_str = r.error[:30] if r.error else "OK"
        print(
            f"{r.client_id:>8} "
            f"{r.login_time:>7.3f}s "
            f"{r.session_create_time:>8.3f}s "
            f"{r.prompt_send_time:>7.3f}s "
            f"{first_evt_latency:>9} "
            f"{r.total_time:>7.3f}s "
            f"{r.events_received:>7} "
            f"{error_str}"
        )

    print("-" * 70)
    print(f"Overall wall time: {overall_time:.3f}s")
    print()

    # Detailed event timeline per client
    for r in results:
        if r is None or not r.stream_events:
            continue
        print(f"\n[Client {r.client_id}] Event timeline ({len(r.stream_events)} events):")
        base_ts = r.stream_events[0]["ts"] if r.stream_events else 0
        for evt in r.stream_events[:20]:  # show first 20
            offset = evt["ts"] - base_ts
            print(f"  +{offset:7.3f}s  {evt['type']}")
        if len(r.stream_events) > 20:
            print(f"  ... and {len(r.stream_events) - 20} more events")

    # Check for potential issues
    print("\n=== Analysis ===")
    valid = [r for r in results if r is not None]
    if not valid:
        print("No results to analyze.")
        return

    errors = [r for r in valid if r.error]
    if errors:
        print(f"ERRORS: {len(errors)}/{len(valid)} clients had errors:")
        for r in errors:
            print(f"  Client {r.client_id}: {r.error}")

    totals = [r.total_time for r in valid if not r.error]
    prompts = [r.prompt_send_time for r in valid if not r.error]
    sessions = [r.session_create_time for r in valid if not r.error]

    if totals:
        print(f"Total time  — min: {min(totals):.3f}s, max: {max(totals):.3f}s, spread: {max(totals)-min(totals):.3f}s")
    if prompts:
        print(f"Prompt send — min: {min(prompts):.3f}s, max: {max(prompts):.3f}s, spread: {max(prompts)-min(prompts):.3f}s")
    if sessions:
        print(f"Session create — min: {min(sessions):.3f}s, max: {max(sessions):.3f}s, spread: {max(sessions)-min(sessions):.3f}s")

    if prompts and max(prompts) > 3 * min(prompts) and min(prompts) > 0.01:
        print("\nWARNING: Large spread in prompt send times suggests serialization/contention!")
    if sessions and max(sessions) > 3 * min(sessions) and min(sessions) > 0.01:
        print("\nWARNING: Large spread in session create times suggests serialization/contention!")


if __name__ == "__main__":
    main()
