package protocol

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
)

const MaxCredentialBlobBytes = 5 * 512

type Operation string

const (
	OperationRead   Operation = "read"
	OperationWrite  Operation = "write"
	OperationDelete Operation = "delete"
)

type Request struct {
	Operation Operation `json:"operation"`
	Service   string    `json:"service"`
	Account   string    `json:"account"`
	Payload   *string   `json:"payload,omitempty"`
}

type Response struct {
	OK    bool   `json:"ok"`
	Found *bool  `json:"found,omitempty"`
	Value string `json:"value,omitempty"`
}

func Parse(reader io.Reader) (Request, error) {
	decoder := json.NewDecoder(reader)
	decoder.DisallowUnknownFields()

	var request Request
	if err := decoder.Decode(&request); err != nil {
		return Request{}, errors.New("invalid credential request")
	}

	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return Request{}, errors.New("credential request must contain exactly one JSON value")
	}

	request.Service = strings.TrimSpace(request.Service)
	request.Account = strings.TrimSpace(request.Account)
	if request.Service == "" || request.Account == "" {
		return Request{}, errors.New("credential service and account are required")
	}
	if strings.ContainsRune(request.Service, '\x00') || strings.ContainsRune(request.Account, '\x00') {
		return Request{}, errors.New("credential service and account contain invalid characters")
	}

	switch request.Operation {
	case OperationRead, OperationDelete:
		if request.Payload != nil {
			return Request{}, fmt.Errorf("%s credential request must not contain a payload", request.Operation)
		}
	case OperationWrite:
		if request.Payload == nil {
			return Request{}, errors.New("credential payload is required")
		}
		if *request.Payload == "" {
			return Request{}, errors.New("credential payload must not be empty")
		}
		if len([]byte(*request.Payload)) > MaxCredentialBlobBytes {
			return Request{}, errors.New("credential payload is too large")
		}
	default:
		return Request{}, errors.New("unsupported credential operation")
	}

	return request, nil
}

func Target(request Request) string {
	return "Arkme/" + request.Service + "/" + request.Account
}

func WriteResponse(writer io.Writer, response Response) error {
	return json.NewEncoder(writer).Encode(response)
}
