#!/usr/bin/env bash
# Section 5 - Kafka measurement.
#
# Two different things get measured and they must not be confused:
#   1. What the broker can do on its own (kafka-producer-perf-test).
#   2. What HBI Cloud actually pushes through it end to end, which is what the
#      application is limited by.
#
#   bash benchmarks/kafka-bench.sh [burst_size]

export MSYS_NO_PATHCONV=1
cd /c/Users/Solly/Downloads/HBI-Cloud/cloud || exit 1

BURST=${1:-300}
GROUP=hbi-rating-service
KEXEC="docker compose exec -T kafka"

offsets() { # topic -> total messages across partitions
  $KEXEC /opt/kafka/bin/kafka-run-class.sh kafka.tools.GetOffsetShell \
    --bootstrap-server kafka:9092 --topic "$1" 2>/dev/null \
    | awk -F: '{s+=$3} END {print s+0}'
}

echo "=============================================================="
echo "TOPIC CONFIGURATION"
echo "=============================================================="
$KEXEC /opt/kafka/bin/kafka-topics.sh --bootstrap-server kafka:9092 \
  --describe --topic hbi.ratings 2>/dev/null | head -4
$KEXEC /opt/kafka/bin/kafka-topics.sh --bootstrap-server kafka:9092 \
  --describe --topic hbi.room-events 2>/dev/null | head -4

echo ""
echo "=============================================================="
echo "CUMULATIVE MESSAGES PRODUCED SO FAR"
echo "=============================================================="
R0=$(offsets hbi.ratings)
E0=$(offsets hbi.room-events)
echo "hbi.ratings      = $R0"
echo "hbi.room-events  = $E0"

echo ""
echo "=============================================================="
echo "CONSUMER GROUP STATE (before burst)"
echo "=============================================================="
$KEXEC /opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server kafka:9092 \
  --describe --group "$GROUP" 2>/dev/null | head -8

echo ""
echo "=============================================================="
echo "RAW BROKER CEILING - kafka-producer-perf-test"
echo "  1000 records x 200 bytes, single partition, acks=1"
echo "=============================================================="
$KEXEC /opt/kafka/bin/kafka-producer-perf-test.sh \
  --topic hbi.ratings --num-records 1000 --record-size 200 --throughput -1 \
  --producer-props bootstrap.servers=kafka:9092 acks=1 2>/dev/null | tail -3

echo ""
echo "=============================================================="
echo "APPLICATION BURST - $BURST ratings through the REST API"
echo "=============================================================="
node "$PWD/benchmarks/kafka-burst.mjs" "$BURST"

echo ""
echo "=============================================================="
echo "CONSUMER GROUP STATE (after burst)"
echo "=============================================================="
$KEXEC /opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server kafka:9092 \
  --describe --group "$GROUP" 2>/dev/null | head -8

R1=$(offsets hbi.ratings)
E1=$(offsets hbi.room-events)
echo ""
echo "messages produced during this script:"
echo "  hbi.ratings      + $((R1 - R0))   (includes the 1000 perf-test records)"
echo "  hbi.room-events  + $((E1 - E0))"

echo ""
echo "=============================================================="
echo "CONSUMER ERRORS / RETRIES in rating-service logs"
echo "=============================================================="
echo -n "failed RATING_SUBMITTED handlings: "
docker compose logs rating-service 2>&1 | grep -c "failed handling RATING_SUBMITTED"
echo -n "deserialization errors:            "
docker compose logs rating-service 2>&1 | grep -ci "deserializ" || true
echo -n "listener retries/backoff:          "
docker compose logs rating-service 2>&1 | grep -ciE "Backoff|SeekToCurrent|DefaultErrorHandler" || true
echo -n "malformed events ignored:          "
docker compose logs rating-service 2>&1 | grep -c "ignoring malformed"
echo -n "consumed RATING_SUBMITTED total:   "
docker compose logs rating-service 2>&1 | grep -c "kafka <- RATING_SUBMITTED"
echo -n "consumed room events total:        "
docker compose logs rating-service 2>&1 | grep -cE "kafka <- (ROOM_CREATED|USER_JOINED|USER_LEFT|ROOM_STATE_CHANGED)"
