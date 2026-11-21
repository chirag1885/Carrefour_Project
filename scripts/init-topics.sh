#!/bin/sh
set -eu

broker=redpanda:9092
existing=$(rpk topic list -X "brokers=$broker")
while read -r topic partitions; do
    if printf '%s\n' "$existing" | awk -v topic="$topic" '$1 == topic { found = 1 } END { exit !found }'; then
        continue
    fi
    rpk topic create "$topic" --partitions "$partitions" --replicas 1 -X "brokers=$broker"
done <<'TOPICS'
price.changed 12
stock.changed 12
wishlist.events 6
alert.fanout 12
notification.requested 12
notification.retry.1m 3
notification.retry.5m 3
notification.retry.30m 3
notification.dlq 3
cart.events 6
TOPICS
