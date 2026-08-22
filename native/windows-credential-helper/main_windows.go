//go:build windows

package main

import (
	"errors"
	"fmt"
	"os"
	"syscall"
	"unsafe"

	"github.com/arkme-senx/arkme-dsh-plugin/native/windows-credential-helper/protocol"
)

const (
	credentialTypeGeneric         = 1
	credentialPersistLocalMachine = 2
	errorNotFound                 = syscall.Errno(1168)
)

type filetime struct {
	LowDateTime  uint32
	HighDateTime uint32
}

type credential struct {
	Flags              uint32
	Type               uint32
	TargetName         *uint16
	Comment            *uint16
	LastWritten        filetime
	CredentialBlobSize uint32
	CredentialBlob     *byte
	Persist            uint32
	AttributeCount     uint32
	Attributes         uintptr
	TargetAlias        *uint16
	UserName           *uint16
}

var (
	advapi32        = syscall.NewLazyDLL("advapi32.dll")
	procCredReadW   = advapi32.NewProc("CredReadW")
	procCredWriteW  = advapi32.NewProc("CredWriteW")
	procCredDeleteW = advapi32.NewProc("CredDeleteW")
	procCredFree    = advapi32.NewProc("CredFree")
)

func main() {
	request, err := protocol.Parse(os.Stdin)
	if err != nil {
		fail(err)
	}

	var response protocol.Response
	switch request.Operation {
	case protocol.OperationRead:
		value, found, readErr := readCredential(protocol.Target(request))
		if readErr != nil {
			fail(readErr)
		}
		response = protocol.Response{OK: true, Found: boolPointer(found), Value: value}
	case protocol.OperationWrite:
		if err := writeCredential(protocol.Target(request), request.Account, *request.Payload); err != nil {
			fail(err)
		}
		response = protocol.Response{OK: true}
	case protocol.OperationDelete:
		if err := deleteCredential(protocol.Target(request)); err != nil {
			fail(err)
		}
		response = protocol.Response{OK: true}
	}

	if err := protocol.WriteResponse(os.Stdout, response); err != nil {
		fail(errors.New("could not write credential response"))
	}
}

func readCredential(target string) (string, bool, error) {
	targetName, err := syscall.UTF16PtrFromString(target)
	if err != nil {
		return "", false, errors.New("invalid credential target")
	}

	var result *credential
	success, _, callErr := procCredReadW.Call(
		uintptr(unsafe.Pointer(targetName)),
		credentialTypeGeneric,
		0,
		uintptr(unsafe.Pointer(&result)),
	)
	if success == 0 {
		if errors.Is(callErr, errorNotFound) {
			return "", false, nil
		}
		return "", false, windowsCallError("CredReadW", callErr)
	}
	defer procCredFree.Call(uintptr(unsafe.Pointer(result)))

	if result.CredentialBlobSize == 0 {
		return "", true, nil
	}
	if result.CredentialBlob == nil {
		return "", false, errors.New("CredReadW returned an invalid credential blob")
	}
	value := unsafe.Slice(result.CredentialBlob, int(result.CredentialBlobSize))
	return string(value), true, nil
}

func writeCredential(target, account, payload string) error {
	targetName, err := syscall.UTF16PtrFromString(target)
	if err != nil {
		return errors.New("invalid credential target")
	}
	userName, err := syscall.UTF16PtrFromString(account)
	if err != nil {
		return errors.New("invalid credential account")
	}
	blob := []byte(payload)
	value := credential{
		Type:               credentialTypeGeneric,
		TargetName:         targetName,
		CredentialBlobSize: uint32(len(blob)),
		CredentialBlob:     &blob[0],
		Persist:            credentialPersistLocalMachine,
		UserName:           userName,
	}

	success, _, callErr := procCredWriteW.Call(uintptr(unsafe.Pointer(&value)), 0)
	if success == 0 {
		return windowsCallError("CredWriteW", callErr)
	}
	return nil
}

func deleteCredential(target string) error {
	targetName, err := syscall.UTF16PtrFromString(target)
	if err != nil {
		return errors.New("invalid credential target")
	}
	success, _, callErr := procCredDeleteW.Call(
		uintptr(unsafe.Pointer(targetName)),
		credentialTypeGeneric,
		0,
	)
	if success == 0 && !errors.Is(callErr, errorNotFound) {
		return windowsCallError("CredDeleteW", callErr)
	}
	return nil
}

func windowsCallError(operation string, err error) error {
	var errno syscall.Errno
	if errors.As(err, &errno) {
		return fmt.Errorf("%s failed with Windows error %d", operation, errno)
	}
	return fmt.Errorf("%s failed", operation)
}

func boolPointer(value bool) *bool {
	return &value
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, "Arkme credential helper:", err)
	os.Exit(1)
}
