import asyncio

from aprs_is import APRSISClient


def test_aprs_is_filter_and_packet_history():
    client = APRSISClient(login_callsign="kc3skw")
    client._tracked = {"KC3SKW-8", "KC3SKW-9"}
    assert client._filter_body() == "b/KC3SKW*"

    point = client.ingest("KC3SKW-8>APRS:!3900.00N/07700.00WO/A=032808 Test flight")
    assert point is not None
    assert point["callsign"] == "KC3SKW-8"
    assert point["latitude"] == 39.0
    assert point["longitude"] == -77.0
    assert point["altitude_m"] == 9999.8784
    snapshot = client.snapshot(["KC3SKW-8", "KC3SKW-9"])
    assert snapshot["source"] == "APRS-IS"
    assert len(snapshot["history"]["KC3SKW-8"]) == 1
    assert "KC3SKW-9" not in snapshot["stations"]


def test_aprs_is_ignores_untracked_callsign_and_duplicate_packet():
    client = APRSISClient()
    client._tracked = {"KC3SKW-8"}
    packet = "KC3SKW-8>APRS:!3900.00N/07700.00WO/A=010000"
    assert client.ingest("W3EAX-11>APRS:!3900.00N/07700.00WO/A=010000") is None
    assert client.ingest(packet) is not None
    assert client.ingest(packet) is not None
    assert len(client.history("KC3SKW-8")) == 1


def test_aprs_is_opens_read_only_filtered_connection():
    async def scenario():
        received = []
        login_received = asyncio.Event()

        async def handle(reader, writer):
            received.append((await reader.readline()).decode("ascii").strip())
            writer.write(b"# logresp KC3SKW unverified, server test\r\n")
            await writer.drain()
            login_received.set()
            await reader.read()
            writer.close()
            await writer.wait_closed()

        server = await asyncio.start_server(handle, "127.0.0.1", 0)
        port = server.sockets[0].getsockname()[1]
        client = APRSISClient("127.0.0.1", port, "KC3SKW")
        try:
            await client.start(["KC3SKW-8", "KC3SKW-9"])
            await asyncio.wait_for(login_received.wait(), timeout=2)
            assert client.connected is True
            assert received == [
                "user KC3SKW pass -1 vers UMD-BPP-Predicts 3.6 filter b/KC3SKW*"
            ]
        finally:
            await client.stop()
            server.close()
            await server.wait_closed()

    asyncio.run(scenario())
