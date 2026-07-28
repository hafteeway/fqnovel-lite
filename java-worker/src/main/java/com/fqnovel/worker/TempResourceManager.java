package com.fqnovel.worker;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.Map;

final class TempResourceManager {
    private static final Map<String, File> TEMP_FILES = new HashMap<String, File>();

    private TempResourceManager() {}

    static synchronized File getTempFile(String classpathFile) throws IOException {
        String key = sha256(classpathFile);
        File cached = TEMP_FILES.get(key);
        if (cached != null && cached.exists()) return cached;
        InputStream input = TempResourceManager.class.getClassLoader().getResourceAsStream(classpathFile);
        if (input == null) throw new IOException("Resource not found: " + classpathFile);
        int dot = classpathFile.lastIndexOf('.');
        String extension = dot >= 0 ? classpathFile.substring(dot) : "";
        File tempFile = File.createTempFile("fq_unidbg_", extension);
        tempFile.deleteOnExit();
        try (InputStream in = input; FileOutputStream out = new FileOutputStream(tempFile)) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = in.read(buffer)) >= 0) out.write(buffer, 0, read);
        }
        TEMP_FILES.put(key, tempFile);
        return tempFile;
    }

    static synchronized void cleanup() {
        for (File file : TEMP_FILES.values()) {
            if (file.exists() && !file.delete()) file.deleteOnExit();
        }
        TEMP_FILES.clear();
    }

    private static String sha256(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] bytes = digest.digest(value.getBytes("UTF-8"));
            StringBuilder result = new StringBuilder();
            for (byte item : bytes) result.append(String.format("%02x", item & 0xff));
            return result.toString();
        } catch (Exception error) {
            return Integer.toHexString(value.hashCode());
        }
    }
}
