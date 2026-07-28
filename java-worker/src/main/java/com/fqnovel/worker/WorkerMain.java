package com.fqnovel.worker;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;

public final class WorkerMain {
    private static final ObjectMapper JSON = new ObjectMapper();
    private WorkerMain() {}

    public static void main(String[] args) throws Exception {
        PrintStream protocolOut = System.out;
        System.setOut(System.err);
        UnidbgEngine engine = null;
        try {
            engine = new UnidbgEngine(Boolean.getBoolean("fq.worker.verbose"));
            ObjectNode ready = JSON.createObjectNode();
            ready.put("type", "ready");
            ready.put("workerVersion", "0.1.0");
            ready.set("status", engine.status());
            write(protocolOut, ready);
            BufferedReader reader = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
            String line;
            while ((line = reader.readLine()) != null) {
                if (!line.trim().isEmpty() && !handleLine(engine, protocolOut, line)) break;
            }
        } finally {
            if (engine != null) engine.close();
        }
    }

    private static boolean handleLine(UnidbgEngine engine, PrintStream out, String line) throws Exception {
        JsonNode request;
        try {
            request = JSON.readTree(line);
        } catch (Exception parseError) {
            write(out, error(null, "INVALID_JSON", parseError.getMessage(), false));
            return true;
        }
        String id = request.path("id").asText(null);
        String method = request.path("method").asText("");
        try {
            ObjectNode response = success(id);
            if ("ping".equals(method) || "status".equals(method)) {
                response.set("result", engine.status());
            } else if ("sign".equals(method)) {
                JsonNode params = request.path("params");
                String url = params.path("url").asText("");
                if (url.isEmpty()) throw new IllegalArgumentException("params.url is required");
                ObjectNode result = JSON.createObjectNode();
                result.set("headers", engine.sign(url, params.path("headers")));
                response.set("result", result);
            } else if ("refresh".equals(method)) {
                response.set("result", engine.refresh());
            } else if ("shutdown".equals(method)) {
                response.set("result", JSON.createObjectNode().put("state", "stopping"));
                write(out, response);
                return false;
            } else {
                write(out, error(id, "UNKNOWN_METHOD", method, false));
                return true;
            }
            write(out, response);
        } catch (Exception requestError) {
            requestError.printStackTrace(System.err);
            write(out, error(id, "WORKER_ERROR", requestError.getMessage(), true));
        }
        return true;
    }

    private static ObjectNode success(String id) {
        ObjectNode response = JSON.createObjectNode();
        response.put("version", 1);
        if (id != null) response.put("id", id);
        response.put("ok", true);
        return response;
    }

    private static ObjectNode error(String id, String code, String message, boolean retryable) {
        ObjectNode response = JSON.createObjectNode();
        response.put("version", 1);
        if (id != null) response.put("id", id);
        response.put("ok", false);
        ObjectNode error = response.putObject("error");
        error.put("code", code);
        error.put("message", message == null ? "" : message);
        error.put("retryable", retryable);
        return response;
    }

    private static void write(PrintStream out, JsonNode message) throws Exception {
        out.println(JSON.writeValueAsString(message));
        out.flush();
    }
}
