/**
 * OP.GG exposes the shared League client build, while TFT uses its own
 * set-scoped patch numbering. Set 17 launched on client 16.7, so client
 * 16.14 is TFT patch 17.8 (and 16.13 is TFT patch 17.7).
 */
const TFT_PATCH_ALIGNMENTS = new Map([
  [17, { clientMajor: 16, clientStartMinor: 7 }]
]);

function clientPatchFromVersion(version) {
  if (typeof version !== "string" || !version) {
    return null;
  }
  const match =
    version.match(/Releases\/(\d+\.\d+)/u) ??
    version.match(/Version (\d+\.\d+)/u) ??
    version.match(/^(\d+\.\d+)/u);
  return match?.[1] ?? null;
}

function patchLabelFromVersion(version, { setNumber = null } = {}) {
  const clientPatch = clientPatchFromVersion(version);
  if (!clientPatch) {
    return null;
  }

  const numericSet = Number(setNumber);
  const alignment = TFT_PATCH_ALIGNMENTS.get(numericSet);
  if (!alignment) {
    return clientPatch;
  }

  const [clientMajor, clientMinor] = clientPatch.split(".").map(Number);
  if (
    clientMajor !== alignment.clientMajor ||
    !Number.isFinite(clientMinor) ||
    clientMinor < alignment.clientStartMinor
  ) {
    return clientPatch;
  }

  return `${numericSet}.${clientMinor - alignment.clientStartMinor + 1}`;
}

export { TFT_PATCH_ALIGNMENTS, clientPatchFromVersion, patchLabelFromVersion };
