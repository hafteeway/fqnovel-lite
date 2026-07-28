package com.fqnovel.worker;

import java.io.PrintStream;
import java.util.regex.Matcher;

final class WorkerLog {
    private final String name;
    private final PrintStream sink = System.err;

    WorkerLog(Class<?> type) {
        this.name = type.getSimpleName();
    }

    void debug(String message, Object... args) {
        if (Boolean.getBoolean("fq.worker.verbose")) write("DEBUG", message, args);
    }

    void info(String message, Object... args) { write("INFO", message, args); }
    void warn(String message, Object... args) { write("WARN", message, args); }
    void error(String message, Object... args) { write("ERROR", message, args); }

    private void write(String level, String template, Object... args) {
        Throwable throwable = null;
        String rendered = template == null ? "" : template;
        if (args != null) {
            for (Object arg : args) {
                if (arg instanceof Throwable) throwable = (Throwable) arg;
                else rendered = rendered.replaceFirst("\\{\\}", Matcher.quoteReplacement(String.valueOf(arg)));
            }
        }
        sink.println("[" + level + "] [" + name + "] " + rendered);
        if (throwable != null) throwable.printStackTrace(sink);
    }
}
