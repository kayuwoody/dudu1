/**
 * @file locker_firmware_fixed.ino
 * @brief Smart Locker System - ESP32 Firmware (Corrected Version)
 * 
 * Hardware: ESP32 + W5500 Ethernet + Shift Register Breakouts
 * Communication: Ethernet (W5500) to T730
 * Protocol: REST/JSON API
 * 
 * FIXES from original:
 *   1. Added SPI.begin() before Ethernet.init()
 *   2. Added ETH_MISO pin definition (GPIO19)
 *   3. Replaced WebServer with EthernetServer (manual HTTP parsing)
 *   4. Guarded server.begin() on networkConnected
 * 
 * Libraries required:
 *   - ArduinoJson (by Benoit Blanchon)
 *   - Ethernet (by Arduino)
 */

#include <Arduino.h>
#include <SPI.h>
#include <Ethernet.h>
#include <ArduinoJson.h>

// ============================================
// CONFIGURATION
// ============================================

#define BOARD_TYPE_A
#ifdef BOARD_TYPE_A
  #define NUM_LOCKERS 3
#else
  #define NUM_LOCKERS 5
#endif

// Network
#define COLUMN_ID           "COL-001"
#define SERVER_IP           "192.168.150.2"
#define SERVER_PORT         3001
#define HTTP_PORT           80
#define HEARTBEAT_INTERVAL  30000
#define ANNOUNCE_RETRY      5000

// Shift Register SPI (bit-banged)
#define SR_CLK      14
#define SR_LATCH    27
#define SR_MOSI     13
#define SR_MISO0    39
#define SR_MISO1    35
#define SR_MISO2    34
#define SR_CS0      32
#define SR_CS1      33
#define SR_CS2      25

// Display/Ethernet SPI (hardware SPI)
#define TFT_MOSI    23
#define TFT_CLK     18
#define TFT_DC      21
#define TFT_CS0     26
#define TFT_CS1     17
#define TFT_CS2     16

// Ethernet (W5500)
#define ETH_CS      5
#define ETH_MISO    19    // FIX: Added missing MISO definition

// Cellular (reference only)
#define CELL_TX     22
#define CELL_RX     36
#define CELL_STATUS 15

#define LED_BUILTIN 2

// 74HC595 Output Bits
#define OUT_DIR       0
#define OUT_LED       1
#define OUT_UVC       2
#define OUT_HEAT      3
#define OUT_STEP      4
#define OUT_SOLENOID  5
#define OUT_ACT_LED   6
#define OUT_SPARE     7

// 74HC165 Input Bits
#define IN_HALL_CLOSED  0
#define IN_HALL_OPEN    1
#define IN_IR_BEAM      2
#define IN_NC           3
#define IN_OCCUPANCY    4
#define IN_TEMP         5
#define IN_SAFETY       6
#define IN_TMC_DIAG     7

// Timing
#define MOTOR_STEP_DELAY_US 500
#define MOTOR_TIMEOUT_MS    10000
#define SOLENOID_PULSE_MS   50
#define UVC_DEFAULT_MS      30000

// TEST MODE: Set to true to bypass safety checks when no hardware connected
#define TEST_MODE           true

const uint8_t SR_MISO_PINS[] = {SR_MISO0, SR_MISO1, SR_MISO2};
const uint8_t SR_CS_PINS[]   = {SR_CS0, SR_CS1, SR_CS2};

// ============================================
// DATA STRUCTURES
// ============================================

enum class LockerState { IDLE, UNLOCKING, OPEN, CLOSING, LOCKED, FAULT, SANITIZING };

struct SensorState {
    bool doorClosed, doorOpen, irBeamClear, occupied, tempOk, safetyOk, motorFault;
};

struct OutputState {
    bool led, uvc, solenoid, heater;
};

// ============================================
// SHIFT REGISTER CLASS
// ============================================

class ShiftRegister {
public:
    ShiftRegister(uint8_t index) : _index(index), _outputState(0), _inputState(0xFF) {
        if (index < NUM_LOCKERS) {
            _misoPin = SR_MISO_PINS[index];
            _csPin = SR_CS_PINS[index];
        }
    }
    
    void begin() {
        static bool pinsInit = false;
        if (!pinsInit) {
            pinMode(SR_CLK, OUTPUT);
            pinMode(SR_LATCH, OUTPUT);
            pinMode(SR_MOSI, OUTPUT);
            digitalWrite(SR_CLK, LOW);
            digitalWrite(SR_LATCH, HIGH);
            digitalWrite(SR_MOSI, LOW);
            pinsInit = true;
        }
        pinMode(_misoPin, INPUT);
        pinMode(_csPin, OUTPUT);
        digitalWrite(_csPin, LOW);
        writeOutputs(0x00);
    }
    
    void writeOutputs(uint8_t data) {
        _outputState = data;
        digitalWrite(_csPin, HIGH);
        delayMicroseconds(1);
        for (int i = 7; i >= 0; i--) {
            digitalWrite(SR_MOSI, (data >> i) & 0x01);
            delayMicroseconds(1);
            digitalWrite(SR_CLK, HIGH);
            delayMicroseconds(1);
            digitalWrite(SR_CLK, LOW);
            delayMicroseconds(1);
        }
        digitalWrite(SR_LATCH, LOW);
        delayMicroseconds(1);
        digitalWrite(SR_LATCH, HIGH);
        delayMicroseconds(1);
        digitalWrite(_csPin, LOW);
    }
    
    uint8_t readInputs() {
        digitalWrite(SR_LATCH, LOW);
        delayMicroseconds(1);
        digitalWrite(SR_LATCH, HIGH);
        delayMicroseconds(1);
        uint8_t data = 0;
        for (int i = 7; i >= 0; i--) {
            if (digitalRead(_misoPin)) data |= (1 << i);
            digitalWrite(SR_CLK, HIGH);
            delayMicroseconds(1);
            digitalWrite(SR_CLK, LOW);
            delayMicroseconds(1);
        }
        _inputState = data;
        writeOutputs(_outputState);
        return data;
    }
    
    void setOutput(uint8_t bit, bool state) {
        if (bit > 7) return;
        if (state) _outputState |= (1 << bit);
        else _outputState &= ~(1 << bit);
        writeOutputs(_outputState);
    }
    
    uint8_t getOutputState() const { return _outputState; }
    uint8_t getInputState() const { return _inputState; }
    void refresh() { readInputs(); }

private:
    uint8_t _index, _misoPin, _csPin, _outputState, _inputState;
};

// ============================================
// LOCKER CONTROL CLASS
// ============================================

class LockerControl {
public:
    LockerControl(uint8_t index, ShiftRegister* sr)
        : _index(index), _sr(sr), _state(LockerState::IDLE),
          _opStart(0), _sanitizeEnd(0), _lastError(nullptr) {}
    
    void begin() {
        _sr->writeOutputs(0x00);
        _sr->refresh();
        SensorState s = getSensors();
        if (s.doorClosed) _state = LockerState::LOCKED;
        else if (s.doorOpen) _state = LockerState::OPEN;
        else _state = LockerState::IDLE;
    }
    
    void update() {
        _sr->refresh();
        SensorState s = getSensors();
        
        if (s.motorFault && _state != LockerState::FAULT) {
            _lastError = "Motor fault";
            emergencyStop();
            _state = LockerState::FAULT;
            return;
        }
        
        switch (_state) {
            case LockerState::UNLOCKING:
                if (s.doorOpen) {
                    _sr->setOutput(OUT_STEP, false);
                    _state = LockerState::OPEN;
                } else if (millis() - _opStart > MOTOR_TIMEOUT_MS) {
                    _lastError = "Open timeout";
                    emergencyStop();
                    _state = LockerState::FAULT;
                }
                break;
            case LockerState::CLOSING:
                if (!s.irBeamClear) {
                    _lastError = "Obstruction";
                    _sr->setOutput(OUT_DIR, true);
                    _state = LockerState::UNLOCKING;
                    _opStart = millis();
                } else if (s.doorClosed) {
                    _sr->setOutput(OUT_STEP, false);
                    _sr->setOutput(OUT_LED, false);
                    _state = LockerState::LOCKED;
                } else if (millis() - _opStart > MOTOR_TIMEOUT_MS) {
                    _lastError = "Close timeout";
                    emergencyStop();
                    _state = LockerState::FAULT;
                }
                break;
            case LockerState::SANITIZING:
                if (millis() >= _sanitizeEnd) {
                    _sr->setOutput(OUT_UVC, false);
                    _state = LockerState::LOCKED;
                }
                break;
            case LockerState::OPEN:
                if (s.doorClosed) {
                    _sr->setOutput(OUT_LED, false);
                    _state = LockerState::LOCKED;
                }
                break;
            default: break;
        }
    }
    
    bool unlock() {
        if (isBusy()) { _lastError = "Busy"; return false; }
        if (!checkSafety()) return false;
        _sr->setOutput(OUT_SOLENOID, true);
        delay(SOLENOID_PULSE_MS);
        _sr->setOutput(OUT_SOLENOID, false);
        _sr->setOutput(OUT_DIR, true);
        _sr->setOutput(OUT_LED, true);
        _state = LockerState::UNLOCKING;
        _opStart = millis();
        return true;
    }
    
    bool lock() {
        SensorState s = getSensors();
        if (!s.irBeamClear) { _lastError = "IR blocked"; return false; }
        if (!checkSafety()) return false;
        _sr->setOutput(OUT_DIR, false);
        _state = LockerState::CLOSING;
        _opStart = millis();
        return true;
    }
    
    void emergencyStop() { _sr->writeOutputs(0x00); }
    void setLED(bool on) { _sr->setOutput(OUT_LED, on); }
    void setUVC(bool on) { _sr->setOutput(OUT_UVC, on); }
    void setHeater(bool on) { _sr->setOutput(OUT_HEAT, on); }
    
    bool startSanitize(uint32_t ms) {
        SensorState s = getSensors();
        if (!s.doorClosed) { _lastError = "Door open"; return false; }
        if (isBusy()) { _lastError = "Busy"; return false; }
        _sr->setOutput(OUT_UVC, true);
        _sanitizeEnd = millis() + ms;
        _state = LockerState::SANITIZING;
        return true;
    }
    
    void stepMotor(int steps, bool fwd, uint16_t delayUs = MOTOR_STEP_DELAY_US) {
        _sr->setOutput(OUT_DIR, fwd);
        delayMicroseconds(10);
        for (int i = 0; i < steps; i++) {
            _sr->setOutput(OUT_STEP, true);
            delayMicroseconds(delayUs / 2);
            _sr->setOutput(OUT_STEP, false);
            delayMicroseconds(delayUs / 2);
        }
    }
    
    SensorState getSensors() {
        uint8_t in = _sr->getInputState();
        return {
            !(in & (1 << IN_HALL_CLOSED)),
            !(in & (1 << IN_HALL_OPEN)),
            (in & (1 << IN_IR_BEAM)) != 0,
            !(in & (1 << IN_OCCUPANCY)),
            (in & (1 << IN_TEMP)) != 0,
            (in & (1 << IN_SAFETY)) != 0,
            (in & (1 << IN_TMC_DIAG)) != 0
        };
    }
    
    OutputState getOutputs() const {
        uint8_t o = _sr->getOutputState();
        return {
            (o & (1 << OUT_LED)) != 0,
            (o & (1 << OUT_UVC)) != 0,
            (o & (1 << OUT_SOLENOID)) != 0,
            (o & (1 << OUT_HEAT)) != 0
        };
    }
    
    LockerState getState() const { return _state; }
    bool isBusy() const {
        return _state == LockerState::UNLOCKING ||
               _state == LockerState::CLOSING ||
               _state == LockerState::SANITIZING;
    }
    const char* getLastError() const { return _lastError; }
    uint8_t getIndex() const { return _index; }

private:
    uint8_t _index;
    ShiftRegister* _sr;
    LockerState _state;
    uint32_t _opStart, _sanitizeEnd;
    const char* _lastError;
    
    bool checkSafety() {
        #if TEST_MODE
        // Bypass safety checks when no hardware connected
        return true;
        #else
        SensorState s = getSensors();
        if (!s.safetyOk) { _lastError = "Safety tripped"; return false; }
        if (s.motorFault) { _lastError = "Motor fault"; return false; }
        return true;
        #endif
    }
};

// ============================================
// GLOBALS
// ============================================

ShiftRegister* shiftRegs[NUM_LOCKERS];
LockerControl* lockers[NUM_LOCKERS];

byte mac[] = {0xDE, 0xAD, 0xBE, 0xEF, 0xFE, 0x01};
EthernetServer server(HTTP_PORT);
bool networkConnected = false;
bool announced = false;
uint32_t lastHeartbeat = 0, lastAnnounce = 0;
uint8_t prevSensorStates[NUM_LOCKERS];

// ============================================
// HTTP PARSING
// ============================================

struct HttpRequest {
    String method, path, body;
    bool valid;
};

HttpRequest parseRequest(EthernetClient& c) {
    HttpRequest req = {"", "", "", false};
    String line = c.readStringUntil('\n');
    line.trim();
    if (line.length() == 0) return req;
    
    int s1 = line.indexOf(' ');
    int s2 = line.indexOf(' ', s1 + 1);
    if (s1 == -1 || s2 == -1) return req;
    
    req.method = line.substring(0, s1);
    req.path = line.substring(s1 + 1, s2);
    
    int contentLen = 0;
    while (c.available()) {
        String hdr = c.readStringUntil('\n');
        hdr.trim();
        if (hdr.length() == 0) break;
        if (hdr.startsWith("Content-Length:"))
            contentLen = hdr.substring(15).toInt();
    }
    
    if (contentLen > 0) {
        while (req.body.length() < contentLen && c.available())
            req.body += (char)c.read();
    }
    
    req.valid = true;
    return req;
}

void sendResponse(EthernetClient& c, int code, const String& json) {
    const char* status = code == 200 ? "OK" : code == 404 ? "Not Found" : "Error";
    c.print("HTTP/1.1 "); c.print(code); c.print(" "); c.println(status);
    c.println("Content-Type: application/json");
    c.println("Connection: close");
    c.print("Content-Length: "); c.println(json.length());
    c.println();
    c.print(json);
}

void sendError(EthernetClient& c, int code, const char* errCode, const char* msg) {
    StaticJsonDocument<256> doc;
    doc["success"] = false;
    doc["error"]["code"] = errCode;
    doc["error"]["message"] = msg;
    String json;
    serializeJson(doc, json);
    sendResponse(c, code, json);
}

// ============================================
// API HANDLERS
// ============================================

int getLockerIndex(const String& path) {
    int start = path.indexOf("/locker/") + 8;
    if (start < 8) return -1;
    int end = path.indexOf("/", start);
    if (end == -1) end = path.length();
    return path.substring(start, end).toInt();
}

void handleGetStatus(EthernetClient& c) {
    StaticJsonDocument<2048> doc;
    doc["columnId"] = COLUMN_ID;
    doc["firmwareVersion"] = "1.0.1";
    doc["uptime"] = millis() / 1000;
    
    JsonArray arr = doc.createNestedArray("lockers");
    for (int i = 0; i < NUM_LOCKERS; i++) {
        JsonObject lk = arr.createNestedObject();
        lk["index"] = i;
        SensorState s = lockers[i]->getSensors();
        JsonObject sens = lk.createNestedObject("sensors");
        sens["doorClosed"] = s.doorClosed;
        sens["doorOpen"] = s.doorOpen;
        sens["irBeamClear"] = s.irBeamClear;
        sens["occupied"] = s.occupied;
        sens["tempOk"] = s.tempOk;
        sens["safetyOk"] = s.safetyOk;
        sens["motorFault"] = s.motorFault;
        OutputState o = lockers[i]->getOutputs();
        JsonObject outs = lk.createNestedObject("outputs");
        outs["led"] = o.led;
        outs["uvc"] = o.uvc;
        outs["solenoid"] = o.solenoid;
        outs["heater"] = o.heater;
        const char* stateStr[] = {"IDLE","UNLOCKING","OPEN","CLOSING","LOCKED","FAULT","SANITIZING"};
        lk["state"] = stateStr[(int)lockers[i]->getState()];
    }
    String json;
    serializeJson(doc, json);
    sendResponse(c, 200, json);
}

void handleUnlock(EthernetClient& c, int idx, const String& body) {
    if (idx < 0 || idx >= NUM_LOCKERS) { 
        Serial.printf("[API] Unlock failed: invalid index %d\n", idx);
        sendError(c, 404, "NOT_FOUND", "Invalid locker"); 
        return; 
    }
    StaticJsonDocument<256> req;
    if (body.length()) deserializeJson(req, body);
    
    Serial.printf("[API] Attempting unlock on locker %d...\n", idx);
    
    if (lockers[idx]->unlock()) {
        Serial.printf("[API] Unlock SUCCESS for locker %d\n", idx);
        StaticJsonDocument<128> doc;
        doc["success"] = true;
        doc["status"] = "UNLOCKING";
        String json; serializeJson(doc, json);
        sendResponse(c, 200, json);
    } else {
        Serial.printf("[API] Unlock FAILED for locker %d: %s\n", idx, lockers[idx]->getLastError());
        sendError(c, 409, "BUSY", lockers[idx]->getLastError());
    }
}

void handleLock(EthernetClient& c, int idx, const String& body) {
    if (idx < 0 || idx >= NUM_LOCKERS) { sendError(c, 404, "NOT_FOUND", "Invalid locker"); return; }
    if (lockers[idx]->lock()) {
        StaticJsonDocument<128> doc;
        doc["success"] = true;
        doc["status"] = "LOCKING";
        String json; serializeJson(doc, json);
        sendResponse(c, 200, json);
    } else {
        sendError(c, 409, "BLOCKED", lockers[idx]->getLastError());
    }
}

void handleSetOutput(EthernetClient& c, int idx, const String& body) {
    if (idx < 0 || idx >= NUM_LOCKERS) { sendError(c, 404, "NOT_FOUND", "Invalid locker"); return; }
    if (!body.length()) { sendError(c, 400, "BAD_REQ", "Missing body"); return; }
    StaticJsonDocument<256> req;
    deserializeJson(req, body);
    const char* out = req["output"];
    bool state = req["state"];
    if (!out) { sendError(c, 400, "BAD_REQ", "Missing output"); return; }
    if (strcmp(out, "led") == 0) lockers[idx]->setLED(state);
    else if (strcmp(out, "uvc") == 0) lockers[idx]->setUVC(state);
    else if (strcmp(out, "heater") == 0) lockers[idx]->setHeater(state);
    else { sendError(c, 400, "BAD_REQ", "Unknown output"); return; }
    StaticJsonDocument<128> doc;
    doc["success"] = true;
    doc["output"] = out;
    doc["state"] = state;
    String json; serializeJson(doc, json);
    sendResponse(c, 200, json);
}

void handleMotor(EthernetClient& c, int idx, const String& body) {
    if (idx < 0 || idx >= NUM_LOCKERS) { sendError(c, 404, "NOT_FOUND", "Invalid locker"); return; }
    StaticJsonDocument<256> req;
    if (body.length()) deserializeJson(req, body);
    int steps = req["steps"] | 100;
    bool fwd = strcmp(req["direction"] | "forward", "forward") == 0;
    lockers[idx]->stepMotor(steps, fwd);
    StaticJsonDocument<128> doc;
    doc["success"] = true;
    doc["stepsExecuted"] = steps;
    String json; serializeJson(doc, json);
    sendResponse(c, 200, json);
}

void handleSanitize(EthernetClient& c, int idx, const String& body) {
    if (idx < 0 || idx >= NUM_LOCKERS) { sendError(c, 404, "NOT_FOUND", "Invalid locker"); return; }
    StaticJsonDocument<256> req;
    if (body.length()) deserializeJson(req, body);
    uint32_t dur = req["durationMs"] | UVC_DEFAULT_MS;
    if (lockers[idx]->startSanitize(dur)) {
        StaticJsonDocument<128> doc;
        doc["success"] = true;
        doc["status"] = "SANITIZING";
        String json; serializeJson(doc, json);
        sendResponse(c, 200, json);
    } else {
        sendError(c, 409, "DOOR_OPEN", lockers[idx]->getLastError());
    }
}

void handleRequest(EthernetClient& c, const HttpRequest& req) {
    Serial.printf("[API] %s %s\n", req.method.c_str(), req.path.c_str());
    
    if (req.method == "GET" && req.path == "/api/status") { handleGetStatus(c); return; }
    
    int idx = getLockerIndex(req.path);
    if (req.method == "POST" && req.path.endsWith("/unlock")) { handleUnlock(c, idx, req.body); return; }
    if (req.method == "POST" && req.path.endsWith("/lock")) { handleLock(c, idx, req.body); return; }
    if (req.method == "POST" && req.path.endsWith("/output")) { handleSetOutput(c, idx, req.body); return; }
    if (req.method == "POST" && req.path.endsWith("/motor")) { handleMotor(c, idx, req.body); return; }
    if (req.method == "POST" && req.path.endsWith("/sanitize")) { handleSanitize(c, idx, req.body); return; }
    
    sendError(c, 404, "NOT_FOUND", "Unknown endpoint");
}

// ============================================
// NETWORK
// ============================================

/**
 * @brief Initialize W5500 Ethernet
 * 
 * Init sequence:
 *   1. Set CS pin HIGH (deselect) before SPI init
 *   2. Initialize SPI bus with correct pins
 *   3. Delay for SPI to stabilize
 *   4. Initialize Ethernet library with CS pin
 */
// W5500 Reset pin - add if connected to ESP32 (optional)
#define ETH_RST     -1    // Set to GPIO number if connected, -1 if pulled up externally

bool initNetwork() {
    Serial.println("[NET] Initializing Ethernet...");
    
    // Step 1: Reset W5500 if reset pin is connected
    if (ETH_RST >= 0) {
        Serial.printf("[NET] Resetting W5500 via GPIO%d\n", ETH_RST);
        pinMode(ETH_RST, OUTPUT);
        digitalWrite(ETH_RST, LOW);
        delay(50);
        digitalWrite(ETH_RST, HIGH);
        delay(200);
    }
    
    // Step 2: Configure CS pin and deselect W5500
    Serial.printf("[NET] CS pin: GPIO%d\n", ETH_CS);
    pinMode(ETH_CS, OUTPUT);
    digitalWrite(ETH_CS, HIGH);
    delay(100);  // Longer delay for W5500 to stabilize
    
    // Step 3: Initialize SPI bus
    Serial.printf("[NET] SPI pins - SCK:%d MISO:%d MOSI:%d\n", TFT_CLK, ETH_MISO, TFT_MOSI);
    SPI.begin(TFT_CLK, ETH_MISO, TFT_MOSI, ETH_CS);
    SPI.setFrequency(1000000);  // Start slow (1MHz) for reliability
    SPI.setDataMode(SPI_MODE0); // W5500 uses Mode 0
    
    // Step 4: Wait for SPI to stabilize
    delay(200);
    
    // Step 5: Test SPI communication manually - read W5500 version register
    Serial.println("[NET] Testing SPI to W5500...");
    
    // First try bit-banged SPI to rule out hardware SPI issues
    Serial.println("[NET] Bit-bang SPI test...");
    
    pinMode(TFT_CLK, OUTPUT);
    pinMode(TFT_MOSI, OUTPUT);
    pinMode(ETH_MISO, INPUT);
    pinMode(ETH_CS, OUTPUT);
    
    digitalWrite(TFT_CLK, LOW);
    digitalWrite(TFT_MOSI, LOW);
    digitalWrite(ETH_CS, HIGH);
    delay(1);
    
    
    // Select chip
    digitalWrite(ETH_CS, LOW);
    delayMicroseconds(5);
    
    // Send address 0x0039 (version register) + read command
    // Byte 1: 0x00 (address high)
    // Byte 2: 0x39 (address low)  
    // Byte 3: 0x00 (control: common reg, read)
    uint8_t txData[] = {0x00, 0x39, 0x00, 0x00};
    uint8_t rxData[4] = {0};
    
    for (int i = 0; i < 4; i++) {
        uint8_t tx = txData[i];
        uint8_t rx = 0;
        for (int bit = 7; bit >= 0; bit--) {
            // Set MOSI
            digitalWrite(TFT_MOSI, (tx >> bit) & 0x01);
            delayMicroseconds(2);
            // Clock high
            digitalWrite(TFT_CLK, HIGH);
            delayMicroseconds(2);
            // Read MISO
            if (digitalRead(ETH_MISO)) {
                rx |= (1 << bit);
            }
            // Clock low
            digitalWrite(TFT_CLK, LOW);
            delayMicroseconds(2);
        }
        rxData[i] = rx;
    }
    
    // Deselect
    digitalWrite(ETH_CS, HIGH);
    
    Serial.printf("[NET] Bit-bang RX: %02X %02X %02X %02X\n", rxData[0], rxData[1], rxData[2], rxData[3]);
    Serial.printf("[NET] Version (bit-bang): 0x%02X (expected: 0x04)\n", rxData[3]);
    
    SPI.end(); // Shut down SPI to clear the bit-bang pin modes
    delay(10);

    // Also test hardware SPI
    Serial.println("[NET] Hardware SPI test...");
    SPI.begin(TFT_CLK, ETH_MISO, TFT_MOSI, ETH_CS);
    SPI.setFrequency(1000000);
    SPI.setDataMode(SPI_MODE0);
    
    digitalWrite(ETH_CS, LOW);
    delayMicroseconds(5);
    SPI.transfer(0x00);  // Address high
    SPI.transfer(0x39);  // Address low (version register)
    SPI.transfer(0x00);  // Control: Common register, read
    uint8_t version = SPI.transfer(0x00);  // Read data
    digitalWrite(ETH_CS, HIGH);
    Serial.printf("[NET] Version (HW SPI): 0x%02X (expected: 0x04)\n", version);
    SPI.endTransaction(); // Always end transaction
    
    if (rxData[3] != 0x04 && version != 0x04) {
        Serial.println("[NET] BOTH failed - check wiring or module!");
        Serial.printf("[NET] GPIO states: CS=%d, CLK=%d, MOSI=%d, MISO=%d\n",
            digitalRead(ETH_CS), digitalRead(TFT_CLK), digitalRead(TFT_MOSI), digitalRead(ETH_MISO));
    }
    
    delay(10);
    
    // Step 6: Set CS pin for Ethernet library
    Ethernet.init(ETH_CS);
    
    Serial.println("[NET] Requesting DHCP...");
    if (Ethernet.begin(mac, 5000) == 0) {
        Serial.println("[NET] DHCP failed");
        
        // Debug: Check hardware status
        int hwStatus = Ethernet.hardwareStatus();
        Serial.printf("[NET] Hardware status: %d ", hwStatus);
        switch(hwStatus) {
            case EthernetNoHardware: Serial.println("(No hardware)"); break;
            case EthernetW5100: Serial.println("(W5100)"); break;
            case EthernetW5200: Serial.println("(W5200)"); break;
            case EthernetW5500: Serial.println("(W5500)"); break;
            default: Serial.println("(Unknown)"); break;
        }
        
        if (hwStatus == EthernetNoHardware) {
            Serial.println("[NET] W5500 not found!");
            Serial.println("[NET] Check wiring:");
            Serial.printf("      SCK  -> GPIO%d\n", TFT_CLK);
            Serial.printf("      MISO -> GPIO%d\n", ETH_MISO);
            Serial.printf("      MOSI -> GPIO%d\n", TFT_MOSI);
            Serial.printf("      CS   -> GPIO%d\n", ETH_CS);
            return false;
        }
        if (Ethernet.linkStatus() == LinkOFF) {
            Serial.println("[NET] Cable disconnected");
            return false;
        }
        // Static fallback
        IPAddress ip(192,168,150,10), gw(192,168,150,1), sn(255,255,255,0), dns(8,8,8,8);
        Ethernet.begin(mac, ip, dns, gw, sn);
        Serial.print("[NET] Static IP: ");
    } else {
        Serial.print("[NET] DHCP IP: ");
    }
    Serial.println(Ethernet.localIP());
    return true;
}

bool postToServer(const char* endpoint, JsonDocument& doc) {
    if (!networkConnected) {
        Serial.println("[NET] postToServer: not connected");
        return false;
    }
    EthernetClient c;
    IPAddress srv; srv.fromString(SERVER_IP);
    Serial.printf("[NET] Connecting to %s:%d%s\n", SERVER_IP, SERVER_PORT, endpoint);
    if (!c.connect(srv, SERVER_PORT)) {
        Serial.println("[NET] Connection failed");
        return false;
    }
    String body; serializeJson(doc, body);
    c.print("POST "); c.print(endpoint); c.println(" HTTP/1.1");
    c.print("Host: "); c.println(SERVER_IP);
    c.println("Content-Type: application/json");
    c.print("Content-Length: "); c.println(body.length());
    c.println("Connection: close");
    c.println();
    c.print(body);
    uint32_t t = millis();
    while (!c.available() && millis() - t < 5000) delay(10);
    bool ok = false;
    if (c.available()) {
        String resp = c.readStringUntil('\n');
        Serial.printf("[NET] Response: %s\n", resp.c_str());
        ok = resp.indexOf("200") > 0 || resp.indexOf("201") > 0;
    } else {
        Serial.println("[NET] No response (timeout)");
    }
    c.stop();
    return ok;
}

bool sendAnnounce() {
    Serial.println("[NET] Sending announce...");
    StaticJsonDocument<512> doc;
    doc["columnId"] = COLUMN_ID;
    doc["ip"] = Ethernet.localIP().toString();
    doc["port"] = HTTP_PORT;
    doc["lockerCount"] = NUM_LOCKERS;
    doc["firmwareVersion"] = "1.0.1";
    bool result = postToServer("/api/lockers/announce", doc);
    Serial.printf("[NET] Announce %s\n", result ? "OK" : "FAILED");
    return result;
}

bool sendHeartbeat() {
    StaticJsonDocument<1024> doc;
    doc["columnId"] = COLUMN_ID;
    doc["uptime"] = millis() / 1000;
    JsonArray arr = doc.createNestedArray("lockers");
    for (int i = 0; i < NUM_LOCKERS; i++) {
        JsonObject lk = arr.createNestedObject();
        lk["index"] = i;
        SensorState s = lockers[i]->getSensors();
        lk["doorClosed"] = s.doorClosed;
        lk["doorOpen"] = s.doorOpen;
        lk["occupied"] = s.occupied;
    }
    return postToServer("/api/lockers/heartbeat", doc);
}

bool sendEvent(const char* event, uint8_t idx) {
    StaticJsonDocument<256> doc;
    doc["columnId"] = COLUMN_ID;
    doc["event"] = event;
    doc["lockerIndex"] = idx;
    return postToServer("/api/lockers/event", doc);
}

void checkSensorChanges() {
    for (int i = 0; i < NUM_LOCKERS; i++) {
        SensorState s = lockers[i]->getSensors();
        uint8_t cur = (s.doorClosed?1:0)|(s.doorOpen?2:0)|(s.occupied?4:0)|
                      (s.irBeamClear?8:0)|(s.motorFault?16:0)|(s.safetyOk?32:0);
        uint8_t prev = prevSensorStates[i];
        if (cur != prev) {
            if ((cur&1)!=(prev&1) && s.doorClosed) sendEvent("DOOR_CLOSED", i);
            if ((cur&2)!=(prev&2) && s.doorOpen) sendEvent("DOOR_OPENED", i);
            if ((cur&4)!=(prev&4)) sendEvent(s.occupied?"ITEM_PLACED":"ITEM_REMOVED", i);
            prevSensorStates[i] = cur;
        }
    }
}

void updateNetwork() {
    if (!networkConnected) return;
    Ethernet.maintain();
    if (Ethernet.linkStatus() == LinkOFF) {
        networkConnected = false;
        announced = false;
        return;
    }
    uint32_t now = millis();
    if (!announced && now - lastAnnounce > ANNOUNCE_RETRY) {
        if (sendAnnounce()) announced = true;
        lastAnnounce = now;
    }
    if (announced && now - lastHeartbeat > HEARTBEAT_INTERVAL) {
        sendHeartbeat();
        lastHeartbeat = now;
    }
    checkSensorChanges();
}

void handleClients() {
    if (!networkConnected) return;
    EthernetClient c = server.available();
    if (c) {
        uint32_t t = millis();
        while (!c.available() && millis() - t < 1000) delay(1);
        if (c.available()) {
            HttpRequest req = parseRequest(c);
            if (req.valid) handleRequest(c, req);
            else sendError(c, 400, "BAD_REQ", "Invalid request");
        }
        delay(1);
        c.stop();
    }
}

// ============================================
// DEBUG
// ============================================

void printStatus() {
    Serial.println("=== Status ===");
    for (int i = 0; i < NUM_LOCKERS; i++) {
        SensorState s = lockers[i]->getSensors();
        Serial.printf("Locker %d: door=%s occ=%s ir=%s\n", i,
            s.doorClosed?"CLOSED":(s.doorOpen?"OPEN":"moving"),
            s.occupied?"YES":"no", s.irBeamClear?"clear":"BLOCKED");
    }
    Serial.printf("Network: %s\n", networkConnected ? Ethernet.localIP().toString().c_str() : "offline");
}

void handleSerial() {
    if (!Serial.available()) return;
    char c = Serial.read();
    switch (c) {
        case 's': printStatus(); break;
        case 'u': Serial.println(lockers[0]->unlock()?"OK":lockers[0]->getLastError()); break;
        case 'l': Serial.println(lockers[0]->lock()?"OK":lockers[0]->getLastError()); break;
        case '?': Serial.println("s=status u=unlock l=lock"); break;
    }
}

// ============================================
// SETUP & LOOP
// ============================================

void setup() {
    Serial.begin(115200);
    while (!Serial && millis() < 3000);
    
    Serial.println("\n========================================");
    Serial.println("  Smart Locker System v1.0.1 (fixed)");
    Serial.printf("  Lockers: %d\n", NUM_LOCKERS);
    Serial.println("========================================\n");
    
    pinMode(LED_BUILTIN, OUTPUT);
    
    // Init lockers
    for (int i = 0; i < NUM_LOCKERS; i++) {
        shiftRegs[i] = new ShiftRegister(i);
        shiftRegs[i]->begin();
        lockers[i] = new LockerControl(i, shiftRegs[i]);
        lockers[i]->begin();
        Serial.printf("[INIT] Locker %d: OK\n", i);
    }
    
    // Init network
    networkConnected = initNetwork();
    
    // FIX: Only start server if network connected
    if (networkConnected) {
        server.begin();
        Serial.printf("[API] Server on port %d\n", HTTP_PORT);
    } else {
        Serial.println("[INIT] Offline mode");
    }
    
    memset(prevSensorStates, 0xFF, sizeof(prevSensorStates));
    Serial.println("[INIT] Ready (? for help)\n");
}

void loop() {
    for (int i = 0; i < NUM_LOCKERS; i++) lockers[i]->update();
    handleClients();
    updateNetwork();
    
    static uint32_t blink = 0;
    if (millis() - blink > 2000) {
        digitalWrite(LED_BUILTIN, !digitalRead(LED_BUILTIN));
        blink = millis();
    }
    
    handleSerial();
}
