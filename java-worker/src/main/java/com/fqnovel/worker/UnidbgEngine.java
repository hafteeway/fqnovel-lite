package com.fqnovel.worker;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

final class UnidbgEngine {
    private final boolean verbose;
    private IdleFQ idleFQ;
    private long startedAt;
    private long generation;

    UnidbgEngine(boolean verbose) {
        this.verbose = verbose;
        this.idleFQ = new IdleFQ(verbose);
        this.startedAt = System.currentTimeMillis();
        this.generation = 1L;
    }

    synchronized ArrayNode sign(String url, JsonNode headers) {
        String raw = idleFQ.generateSignature(url, SignatureCodec.formatHeaders(headers));
        if (raw == null || raw.trim().isEmpty()) {
            throw new IllegalStateException("unidbg returned an empty signature");
        }

        ArrayNode parsed = SignatureCodec.parseSignatureHeaders(raw);
        boolean hasArgus = false;
        for (JsonNode pair : parsed) {
            if (pair.isArray() && pair.size() >= 1 && "X-Argus".equalsIgnoreCase(pair.get(0).asText())) {
                hasArgus = true;
                break;
            }
        }
        if (!hasArgus) {
            throw new IllegalStateException("unidbg signature did not contain X-Argus");
        }
        return parsed;
    }

    synchronized ObjectNode refresh() {
        IdleFQ replacement = new IdleFQ(verbose);
        IdleFQ previous = idleFQ;
        idleFQ = replacement;
        startedAt = System.currentTimeMillis();
        generation += 1L;
        previous.destroy();
        return status();
    }

    synchronized ObjectNode status() {
        return SignatureCodec.status("ready", startedAt, generation);
    }

    synchronized void close() {
        if (idleFQ != null) {
            idleFQ.destroy();
            idleFQ = null;
        }
        TempResourceManager.cleanup();
    }
}
