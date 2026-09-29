# Appendix: secrets consumed by Kubernetes through External Secrets

Read this only when the repository deploys to a cluster that reads Infisical through the
[External Secrets Operator](https://external-secrets.io) (`ExternalSecret` → `ClusterSecretStore` →
Infisical).

## An ExternalSecret fails as a whole

An `ExternalSecret` that names one missing key does not sync **any** of its keys. A chart that starts
consuming a new key should ship with that block **off** (a values flag), and be switched on only
after the key exists:

1. Create the value (`secret.mjs create …`) in the project and environment the store reads.
2. Check it (`secret.mjs exists …`).
3. Flip the flag, commit, and let the GitOps tool sync.

## Which store reads which project

```sh
kubectl get clustersecretstore -o jsonpath=\
'{range .items[*]}{.metadata.name}{"\t"}{.spec.provider.infisical.secretsScope.projectSlug}{"\t"}{.spec.provider.infisical.secretsScope.environmentSlug}{"\n"}{end}'
```

A secret in the wrong project does not fail on write; it fails later as an `ExternalSecret` that will
not sync.

## Using the cluster's machine identity

When nobody is logged in to the CLI, the identity External Secrets uses can write too. Read it into
the **environment**, never into arguments, and log in with it:

```sh
export INFISICAL_UNIVERSAL_AUTH_CLIENT_ID="$(kubectl -n <namespace> get secret <credentials-secret> -o jsonpath='{.data.clientId}' | base64 -d)"
export INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET="$(kubectl -n <namespace> get secret <credentials-secret> -o jsonpath='{.data.clientSecret}' | base64 -d)"
export INFISICAL_TOKEN="$(infisical login --method=universal-auth --domain="$INFISICAL_DOMAIN/api" --silent --plain | tail -1)"
```

The secret's name is whatever the store references:
`kubectl get clustersecretstore <store> -o jsonpath='{.spec.provider.infisical.auth.universalAuthCredentials}'`.
An older operator may have left a similarly named secret whose identity cannot see the current
projects: it gives a token, not an error.

## After a rotation

An `ExternalSecret` refreshes on its `refreshInterval`. To pick up a rotated value now, annotate it
(`kubectl annotate externalsecret <name> force-sync=$(date +%s) --overwrite`) and then restart the
workloads that read the value only at start-up.

Never delete an `ExternalSecret` or its target `Secret` to "force" anything without checking its
`deletionPolicy`: a blanket prune removes secrets other workloads still mount.
