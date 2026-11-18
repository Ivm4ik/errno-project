// One JSON line per second. No raw ECG: send heart rate, SpO2 and temperature.
// Stubs return simulated values so the sketch runs with no sensors attached.
#include <ArduinoJson.h>

static uint32_t seq = 0;

float readHeartRate() { return 72; }
float readSpO2() { return 98; }
float readTemp() { return 36.6; }
int leadOff() { return 0; }

void setup() {
  Serial.begin(115200);
}

void loop() {
  StaticJsonDocument<256> doc;
  doc["seq"] = seq++;
  doc["ms"] = millis();
  doc["hr"] = readHeartRate();
  doc["spo2"] = readSpO2();
  doc["temp"] = readTemp();
  doc["lo"] = leadOff();
  serializeJson(doc, Serial);
  Serial.println();
  delay(1000);
}

// Wi-Fi alternative (same JSON, POST /ingest):
// #include <WiFi.h>
// #include <HTTPClient.h>
// HTTPClient http;
// http.begin("http://192.168.1.10:8000/ingest");
// http.addHeader("Content-Type", "application/json");
// http.addHeader("X-Device-Token", "secret");
// String body;
// serializeJson(doc, body);
// http.POST("{\"device_id\":\"gw-1\",\"astronaut_id\":\"A1\",\"seq\":" + String(seq) + ",\"readings\":[...]}");
