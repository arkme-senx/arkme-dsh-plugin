package protocol

import (
	"bytes"
	"strings"
	"testing"
)

func TestParseValidRequests(t *testing.T) {
	tests := []struct {
		name      string
		input     string
		operation Operation
		payload   *string
	}{
		{name: "read", input: `{"operation":"read","service":"com.senqisi.dsh-arkme.prod","account":"session"}`, operation: OperationRead},
		{name: "delete", input: `{"operation":"delete","service":"com.senqisi.dsh-arkme.prod","account":"session"}`, operation: OperationDelete},
		{name: "write", input: `{"operation":"write","service":"com.senqisi.dsh-arkme.prod","account":"session","payload":"session-json"}`, operation: OperationWrite, payload: stringPointer("session-json")},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			request, err := Parse(strings.NewReader(tt.input))
			if err != nil {
				t.Fatalf("Parse() error = %v", err)
			}
			if request.Operation != tt.operation {
				t.Fatalf("operation = %q, want %q", request.Operation, tt.operation)
			}
			if request.Payload == nil && tt.payload != nil || request.Payload != nil && tt.payload == nil {
				t.Fatalf("payload presence mismatch: got %v, want %v", request.Payload, tt.payload)
			}
			if request.Payload != nil && *request.Payload != *tt.payload {
				t.Fatalf("payload = %q, want %q", *request.Payload, *tt.payload)
			}
		})
	}
}

func TestTargetUsesStableArkmeNamespace(t *testing.T) {
	request, err := Parse(strings.NewReader(`{"operation":"read","service":"com.senqisi.dsh-arkme.prod","account":"session"}`))
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}

	if got, want := Target(request), "Arkme/com.senqisi.dsh-arkme.prod/session"; got != want {
		t.Fatalf("Target() = %q, want %q", got, want)
	}
}

func TestParseRejectsInvalidRequests(t *testing.T) {
	tests := []struct {
		name  string
		input string
	}{
		{name: "write without payload", input: `{"operation":"write","service":"service","account":"account"}`},
		{name: "write with empty payload", input: `{"operation":"write","service":"service","account":"account","payload":""}`},
		{name: "blank service", input: `{"operation":"read","service":" ","account":"account"}`},
		{name: "blank account", input: `{"operation":"read","service":"service","account":" "}`},
		{name: "unsupported operation", input: `{"operation":"list","service":"service","account":"account"}`},
		{name: "trailing JSON", input: `{"operation":"read","service":"service","account":"account"}{}`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := Parse(strings.NewReader(tt.input)); err == nil {
				t.Fatal("Parse() error = nil, want validation error")
			}
		})
	}
}

func TestWriteResponseProducesOneJSONLine(t *testing.T) {
	var output bytes.Buffer
	found := true
	if err := WriteResponse(&output, Response{OK: true, Found: &found, Value: "session-json"}); err != nil {
		t.Fatalf("WriteResponse() error = %v", err)
	}

	if got, want := output.String(), "{\"ok\":true,\"found\":true,\"value\":\"session-json\"}\n"; got != want {
		t.Fatalf("WriteResponse() = %q, want %q", got, want)
	}
}

func stringPointer(value string) *string {
	return &value
}
