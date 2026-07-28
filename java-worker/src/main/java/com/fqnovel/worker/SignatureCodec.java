package com.fqnovel.worker;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.List;

final class SignatureCodec {
    private SignatureCodec() {}

    static String formatHeaders(JsonNode headersNode) {
        if (headersNode == null || !headersNode.isArray()) return "";
        List<String> values = new ArrayList<String>();
        for (JsonNode pair : headersNode) {
            if (!pair.isArray() || pair.size() < 2) continue;
            values.add(pair.get(0).asText());
            values.add(pair.get(1).asText());
        }
        return String.join("\r\n", values);
    }

    static ArrayNode parseSignatureHeaders(String signature) {
        ArrayNode result = JsonNodeFactory.instance.arrayNode();
        if (signature == null || signature.trim().isEmpty()) return result;
        String[] lines = signature.split("\\r?\\n");
        for (int index = 0; index + 1 < lines.length; index += 2) {
            String name = lines[index].trim();
            if ("X-Neptune".equalsIgnoreCase(name)) continue;
            ArrayNode pair = result.addArray();
            pair.add(name);
            pair.add(lines[index + 1].trim());
        }
        return result;
    }

    static ObjectNode status(String state, long startedAt, long generation) {
        ObjectNode node = JsonNodeFactory.instance.objectNode();
        node.put("state", state);
        node.put("startedAt", startedAt);
        node.put("generation", generation);
        node.put("backend", "unicorn2");
        node.put("javaVersion", System.getProperty("java.version"));
        return node;
    }
}
