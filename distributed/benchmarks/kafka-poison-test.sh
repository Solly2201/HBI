#!/usr/bin/env bash
# Kafka poison-message regression test (BUG-6).
#
#   bash benchmarks/kafka-poison-test.sh
#
# Injects a record that is not JSON onto hbi.ratings and verifies that the
# consumer (a) does not retry it forever, (b) parks it on hbi.ratings.DLT,
# (c) reaches lag 0, and (d) keeps processing valid messages afterwards.
# Every step is bounded; the script cannot hang.

set -u
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/.."

KAFKA="docker compose exec -T kafka /opt/kafka/bin"
PASS=0; FAIL=0
check() { # name, condition (0=true)
  if [ "$2" -eq 0 ]; then echo "  PASS  $1"; PASS=$((PASS+1));
  else echo "  FAIL  $1 ${3:-}"; FAIL=$((FAIL+1)); fi
}

lag() {
  timeout 30 $KAFKA/kafka-consumer-groups.sh --bootstrap-server kafka:9092 \
    --describe --group hbi-rating-service 2>/dev/null \
    | awk -v t="$1" '$2==t {print $6}' | head -1
}

dlt_end_offset() {
  # Sum the end offsets across all partitions - the topics are declared with
  # three partitions (KafkaTopicConfig) and the DLT record can land on any.
  timeout 30 $KAFKA/kafka-get-offsets.sh --bootstrap-server kafka:9092 \
    --topic hbi.ratings.DLT 2>/dev/null | awk -F: '{s+=$3} END {print s+0}'
}

echo "=== Kafka poison-message test"

BEFORE_DLT=$(dlt_end_offset); BEFORE_DLT=${BEFORE_DLT:-0}
echo "  (DLT end offset before: $BEFORE_DLT)"

# 1. Inject one poison record (not JSON).
echo "POISON-$(date +%s)-not-json" | timeout 30 $KAFKA/kafka-console-producer.sh \
  --bootstrap-server kafka:9092 --topic hbi.ratings >/dev/null 2>&1
check "poison record injected" $?

# 2. Within 30 s the consumer must have moved past it (lag back to 0).
DEADLINE=$((SECONDS+30)); L=unknown
while [ $SECONDS -lt $DEADLINE ]; do
  L=$(lag hbi.ratings); [ "$L" = "0" ] && break; sleep 2
done
check "consumer lag returns to 0 within 30s (no infinite retry)" \
  "$([ "$L" = "0" ]; echo $?)" "(lag=$L)"

# 3. The record must be on the DLT.
AFTER_DLT=$(dlt_end_offset); AFTER_DLT=${AFTER_DLT:-0}
check "record parked on hbi.ratings.DLT" \
  "$([ "$AFTER_DLT" -gt "$BEFORE_DLT" ] 2>/dev/null; echo $?)" \
  "(DLT $BEFORE_DLT -> $AFTER_DLT)"

# 4. Log volume must be sane: the poison record may produce a handful of log
#    lines, not thousands.
ERRLINES=$(docker compose logs rating-service --since 60s --no-log-prefix 2>/dev/null \
  | grep -c -i "deserial\|DeadLetter\|ErrorHandler")
check "bounded logging (< 50 error lines in the last minute)" \
  "$([ "${ERRLINES:-0}" -lt 50 ]; echo $?)" "(got $ERRLINES)"

# 5. A valid message published after the poison one must still be consumed.
#    RATING_SUBMITTED for a room that does not exist is handled gracefully
#    (progress for an unknown room is empty) but it IS consumed - offset moves.
END_BEFORE=$(timeout 30 $KAFKA/kafka-get-offsets.sh --bootstrap-server kafka:9092 \
  --topic hbi.ratings 2>/dev/null | awk -F: '{print $3}')
echo '{"eventType":"RATING_SUBMITTED","roomId":"HBITEST","userId":1,"foodId":1,"score":5,"occurredAt":"2026-08-23T00:00:00Z"}' \
  | timeout 30 $KAFKA/kafka-console-producer.sh \
    --bootstrap-server kafka:9092 --topic hbi.ratings >/dev/null 2>&1

DEADLINE=$((SECONDS+30)); L=unknown
while [ $SECONDS -lt $DEADLINE ]; do
  L=$(lag hbi.ratings); [ "$L" = "0" ] && break; sleep 2
done
check "valid message after the poison one is consumed (lag 0)" \
  "$([ "$L" = "0" ]; echo $?)" "(lag=$L)"

# 6. CPU sanity: the consumer must be idle-ish, not pinned at 100 %.
CPU=$(docker stats --no-stream --format "{{.CPUPerc}}" hbi-distributed-rating-service-1 | tr -d '%')
CPU_INT=${CPU%.*}
check "rating-service CPU below 50% after the test" \
  "$([ "${CPU_INT:-100}" -lt 50 ]; echo $?)" "(got ${CPU}%)"

echo "------------------------------------------------------------"
echo "$PASS passed, $FAIL failed"
exit $FAIL
