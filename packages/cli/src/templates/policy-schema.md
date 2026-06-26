# layerall policy schema reference

Tenants are keyed by id; `default` is always resolved.

```jsonc
{
  "tenants": {
    "default": {
      "providers": ["providerA", "providerB", "providerC"],
      "operations": {
        "create":  { "strategy": "round_robin",  "timeoutMs": 8000,  "retries": { "max": 1, "backoffMs": 300 }, "failover": true },
        "send":    { "strategy": "load_balance", "weights": { "providerA": 50, "providerB": 30, "providerC": 20 }, "timeoutMs": 12000, "retries": { "max": 2, "backoffMs": 450 } },
        "status":  { "strategy": "most_fast",    "timeoutMs": 6000,  "cacheTtlMs": 5000 },
        "cancel":  { "strategy": "failover",     "timeoutMs": 8000 }
      }
    }
  }
}
```