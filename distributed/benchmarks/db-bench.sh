#!/usr/bin/env bash
# Section 7 - database baseline.
#
# Runs the queries the services actually issue, straight against each Postgres,
# using EXPLAIN (ANALYZE) so the timing excludes JDBC and JVM overhead. Each
# query is executed repeatedly and the per-execution times are summarised.
#
#   bash benchmarks/db-bench.sh [runs]

export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/.." || exit 1

RUNS=${RUNS:-${1:-30}}
USER=${DATABASE_USERNAME:-hbi}

# service|db|label|sql
QUERIES=$(cat <<'SQL'
user-db|user_db|User lookup by id|select * from hbi_user where id = 1
room-db|room_db|Room lookup by code|select * from room where code = (select code from room limit 1)
room-db|room_db|Room members by code|select * from room_member where room_code = (select code from room limit 1) order by joined_at asc
room-db|room_db|Active member count|select count(*) from room_member where room_code = (select code from room limit 1) and active = true
food-db|food_db|Food full catalogue|select * from food_item order by id asc
food-db|food_db|Food search by cuisine|select * from food_item where lower(cuisine) in ('chinese','italian') order by id asc
food-db|food_db|Food search several cuisines|select * from food_item where lower(cuisine) in ('indian','chinese','italian') order by id asc
food-db|food_db|Food bulk lookup by ids|select * from food_item where id in (1,2,3,4,5,6,7,8) order by id asc
rating-db|rating_db|Ratings for a room|select * from rating where room_code = (select room_code from rating limit 1)
rating-db|rating_db|Preferences for a room|select * from preference where room_code = (select room_code from preference limit 1)
rating-db|rating_db|Candidates for a room|select * from room_candidate where room_code = (select room_code from room_candidate limit 1) order by position_no asc
rating-db|rating_db|Recommendations for a room|select * from recommendation where room_code = (select room_code from recommendation limit 1) order by position_no asc
rating-db|rating_db|Decision for a room|select * from decision where room_code = (select room_code from decision limit 1)
rating-db|rating_db|Rating upsert lookup (unique key)|select * from rating where room_code = (select room_code from rating limit 1) and user_id = (select user_id from rating limit 1) and food_id = (select food_id from rating limit 1)
SQL
)

echo "=============================================================="
echo "TABLE SIZES"
echo "=============================================================="
printf "%-16s %-24s %10s\n" "DATABASE" "TABLE" "ROWS"
for pair in "user-db:user_db" "room-db:room_db" "food-db:food_db" "rating-db:rating_db"; do
  svc=${pair%%:*}; db=${pair##*:}
  tables=$(docker compose exec -T "$svc" psql -U "$USER" -d "$db" -tAc \
    "select tablename from pg_tables where schemaname='public' order by tablename" 2>/dev/null)
  for t in $tables; do
    n=$(docker compose exec -T "$svc" psql -U "$USER" -d "$db" -tAc "select count(*) from \"$t\"" 2>/dev/null | tr -d '\r')
    printf "%-16s %-24s %10s\n" "$db" "$t" "$n"
  done
done

echo ""
echo "=============================================================="
echo "QUERY TIMINGS - $RUNS executions each, EXPLAIN ANALYZE"
echo "=============================================================="
printf "%-42s %6s %8s %8s %8s %8s\n" "QUERY" "ROWS" "avg_ms" "med_ms" "p95_ms" "max_ms"

echo "$QUERIES" | while IFS='|' read -r svc db label sql; do
  [ -z "$svc" ] && continue

  rows=$(docker compose exec -T "$svc" psql -U "$USER" -d "$db" -tAc \
    "select count(*) from ($sql) x" 2>/dev/null | tr -d '\r')

  # Collect execution times from EXPLAIN ANALYZE, one line per run.
  times=$(docker compose exec -T "$svc" psql -U "$USER" -d "$db" -tAc \
    "$(for _ in $(seq 1 "$RUNS"); do echo "explain (analyze, timing off, summary on) $sql;"; done)" 2>/dev/null \
    | grep -i "Execution Time" | sed 's/.*: //; s/ ms//' | tr -d '\r')

  if [ -z "$times" ]; then
    printf "%-42s %6s %8s\n" "${label:0:42}" "${rows:-?}" "n/a"
    continue
  fi

  echo "$times" | sort -g | awk -v lbl="${label:0:42}" -v rows="${rows:-?}" '
    {a[NR]=$1; s+=$1}
    END {
      n=NR;
      med=a[int((n+1)/2)];
      p95=a[int(n*0.95)==0?1:int(n*0.95)];
      printf "%-42s %6s %8.3f %8.3f %8.3f %8.3f\n", lbl, rows, s/n, med, p95, a[n];
    }'
done

echo ""
echo "=============================================================="
echo "INDEXES PRESENT"
echo "=============================================================="
for pair in "user-db:user_db" "room-db:room_db" "food-db:food_db" "rating-db:rating_db"; do
  svc=${pair%%:*}; db=${pair##*:}
  echo "--- $db"
  docker compose exec -T "$svc" psql -U "$USER" -d "$db" -tAc \
    "select tablename||' -> '||indexname from pg_indexes where schemaname='public' order by tablename, indexname" 2>/dev/null | tr -d '\r'
done

echo ""
echo "=============================================================="
echo "SEQUENTIAL VS INDEX SCANS (pg_stat_user_tables)"
echo "=============================================================="
printf "%-16s %-22s %10s %10s %12s\n" "DATABASE" "TABLE" "SEQ_SCAN" "IDX_SCAN" "LIVE_ROWS"
for pair in "user-db:user_db" "room-db:room_db" "food-db:food_db" "rating-db:rating_db"; do
  svc=${pair%%:*}; db=${pair##*:}
  docker compose exec -T "$svc" psql -U "$USER" -d "$db" -tAc \
    "select relname||'|'||seq_scan||'|'||coalesce(idx_scan,0)||'|'||n_live_tup from pg_stat_user_tables order by relname" 2>/dev/null \
    | tr -d '\r' | while IFS='|' read -r t s i l; do
        [ -n "$t" ] && printf "%-16s %-22s %10s %10s %12s\n" "$db" "$t" "$s" "$i" "$l"
      done
done
