package managedairuntime

// Loaded only by the plugin's isolated Go test overlay. No backend source is changed.
import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	managedaihttp "jotmo-intelligent/gin/managedai"
	"jotmo-intelligent/internal/managedai"
	"jotmo-intelligent/internal/managedai/deepseekhttp"
	"jotmo-intelligent/internal/managedai/inputassetverify"
)

type toolImageObjects struct {
	mu    sync.Mutex
	data  map[string][]byte
	media map[string]string
	url   string
}

func (o *toolImageObjects) NewObjectKey(_ int64, id string) (string, error) {
	return uuid.NewString(), nil
}
func (o *toolImageObjects) CreateUploadGrant(_ context.Context, key, media string, _ int64, ttl time.Duration) (managedai.InputObjectUploadGrant, error) {
	o.mu.Lock()
	o.media[key] = media
	o.mu.Unlock()
	return managedai.InputObjectUploadGrant{Method: "POST", URL: o.url, Fields: map[string]string{"key": key}, FileField: "file", ExpiresAt: time.Now().Add(ttl).UnixMilli()}, nil
}
func (o *toolImageObjects) Head(_ context.Context, key string) (managedai.ObjectMetadata, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	return managedai.ObjectMetadata{SizeBytes: int64(len(o.data[key])), MediaType: o.media[key]}, nil
}
func (o *toolImageObjects) Open(_ context.Context, key string) (io.ReadCloser, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	return io.NopCloser(bytes.NewReader(o.data[key])), nil
}
func (o *toolImageObjects) Put(_ context.Context, key, media string, r io.Reader, _ int64) error {
	b, e := io.ReadAll(r)
	o.mu.Lock()
	defer o.mu.Unlock()
	o.data[key] = b
	o.media[key] = media
	return e
}
func (o *toolImageObjects) Delete(_ context.Context, key string) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	delete(o.data, key)
	return nil
}
func (o *toolImageObjects) TemporaryGetURL(context.Context, string, time.Duration) (string, error) {
	return "", fmt.Errorf("DeepSeek must use file materialization")
}
func (o *toolImageObjects) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 2<<20)
	if e := r.ParseMultipartForm(2 << 20); e != nil {
		http.Error(w, e.Error(), 400)
		return
	}
	defer r.MultipartForm.RemoveAll()
	file, _, e := r.FormFile("file")
	if e != nil {
		http.Error(w, e.Error(), 400)
		return
	}
	defer file.Close()
	data, e := io.ReadAll(file)
	if e != nil {
		http.Error(w, e.Error(), 400)
		return
	}
	o.mu.Lock()
	o.data[r.FormValue("key")] = data
	o.mu.Unlock()
	w.WriteHeader(204)
}

type toolImageMedia struct{}

func (toolImageMedia) RecoverMissing(context.Context, []managedai.MaterializedImage) (bool, error) {
	return false, nil
}

func (toolImageMedia) MaterializeImage(_ context.Context, a managedai.InputAsset) (managedai.MaterializedImage, error) {
	if !a.Ready() {
		return managedai.MaterializedImage{}, fmt.Errorf("unverified asset")
	}
	return managedai.MaterializedImage{Kind: "file_id", Value: "file-fixture-" + a.SHA256}, nil
}

func TestManagedAIToolImagesBrowserChain(t *testing.T) {
	if os.Getenv("ARKME_MANAGED_AI_TOOL_IMAGES") != "1" {
		t.Skip("isolated plugin runner only")
	}
	plugin, harness := os.Getenv("ARKME_PLUGIN_CHECKOUT"), os.Getenv("ARKME_DSH_CHECKOUT")
	if !filepath.IsAbs(plugin) || !filepath.IsAbs(harness) {
		t.Fatal("absolute test paths required")
	}
	db := isolatedCatalogDB(t)
	applyCatalogMigrations(t, db, 15, 20)
	ctx, cancel := context.WithTimeout(t.Context(), 4*time.Minute)
	defer cancel()
	store := managedai.NewMySQLStore(db)
	registry, e := newProviderRegistry([]ProviderProfileConfig{{Key: "deepseek-managed-primary", Supplier: managedai.ProviderDeepSeek, APIKey: "fixture"}}, 2, nil, nil)
	if e != nil {
		t.Fatal(e)
	}
	manager := managedai.NewCatalogManager(store, registry)
	base, e := manager.CurrentCatalog(ctx)
	if e != nil {
		t.Fatal(e)
	}
	draft, e := manager.CreateCatalogDraft(ctx, base.ID, "Tool images", "isolated", 9001)
	if e != nil {
		t.Fatal(e)
	}
	offering := draft.Offerings[0]
	offering.DisplayName = "Tool Images Text"
	offering.DefaultMaxOutputTokens = 1024
	offering.MaximumMaxOutputTokens = 4096
	offering.CacheHitInputNanoPerToken = 40
	offering.CacheMissInputNanoPerToken = 2000
	offering.OutputNanoPerToken = 8000
	offering.ServiceFeeBasisPoints = 1000
	vision := offering
	vision.ID = 0
	vision.PublicModelCode = "tool-images-vision"
	vision.UpstreamModel = managedai.ModelDeepSeekVisionExp
	vision.DisplayName = "Tool Images Vision"
	vision.IsDefault = false
	vision.SortOrder = 20
	draft, e = manager.SaveCatalogDraft(ctx, managedai.SaveCatalogDraftCommand{ReleaseID: draft.ID, ExpectedContentVersion: draft.ContentVersion, Title: draft.Title, Note: draft.Note, Offerings: []managedai.OfferingConfig{offering, vision}, OperatorUserID: 9001})
	if e != nil {
		t.Fatal(e)
	}
	_, e = manager.PublishCatalogDraft(ctx, managedai.PublishCatalogCommand{ReleaseID: draft.ID, ExpectedContentVersion: draft.ContentVersion, ExpectedActiveReleaseID: base.ID, OperatorUserID: 9001})
	if e != nil {
		t.Fatal(e)
	}
	_, e = store.Credit(ctx, managedai.CreditCommand{GrantUID: uuid.NewString(), UserID: 42, AmountNanoCNY: 10_000_000_000, SourceType: "backend_ai_purchase", SourceUID: uuid.NewString(), CreatedAt: time.Now()})
	if e != nil {
		t.Fatal(e)
	}
	objects := &toolImageObjects{data: map[string][]byte{}, media: map[string]string{}}
	cert, e := tls.LoadX509KeyPair(os.Getenv("NODE_EXTRA_CA_CERTS"), os.Getenv("ARKME_E2E_TLS_KEY"))
	if e != nil {
		t.Fatal(e)
	}
	uploadServer := httptest.NewUnstartedServer(objects)
	uploadServer.TLS = &tls.Config{Certificates: []tls.Certificate{cert}, MinVersion: tls.VersionTLS12}
	uploadServer.StartTLS()
	defer uploadServer.Close()
	objects.url = uploadServer.URL
	var mu sync.Mutex
	var positions []int
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Model    string `json:"model"`
			Messages []struct {
				Role       string          `json:"role"`
				Content    json.RawMessage `json:"content"`
				ToolCallID string          `json:"tool_call_id"`
			} `json:"messages"`
			Tools []struct {
				Function struct {
					Name string `json:"name"`
				} `json:"function"`
			} `json:"tools"`
		}
		if json.NewDecoder(r.Body).Decode(&body) != nil {
			http.Error(w, "bad request", 400)
			return
		}
		count := 0
		toolIDs := []string{}
		lastText := ""
		for _, m := range body.Messages {
			if m.Role == "tool" {
				toolIDs = append(toolIDs, m.ToolCallID)
				var s string
				if json.Unmarshal(m.Content, &s) != nil {
					t.Error("tool content is not text")
				}
			}
			var parts []struct {
				Type   string `json:"type"`
				FileID string `json:"file_id"`
			}
			if json.Unmarshal(m.Content, &parts) == nil {
				for _, p := range parts {
					if p.Type == "file" {
						count++
						if m.Role != "user" || !strings.HasPrefix(p.FileID, "file-fixture-") {
							t.Error("invalid provider image representation")
						}
					}
				}
			}
			if m.Role == "user" {
				var s string
				if json.Unmarshal(m.Content, &s) == nil && strings.Contains(s, "E2E_READ_TOOL_IMAGES ") {
					lastText = s
				}
			}
		}
		mu.Lock()
		index := len(positions)
		positions = append(positions, count)
		mu.Unlock()
		w.Header().Set("Content-Type", "text/event-stream")
		delta := map[string]any{"content": "TOOL_IMAGES_OK"}
		reason := "stop"
		if index == 0 {
			found := false
			for _, tool := range body.Tools {
				if tool.Function.Name == "read_image" {
					found = true
				}
			}
			if !found {
				t.Error("real read_image tool is missing")
			}
			marker := "E2E_READ_TOOL_IMAGES "
			i := strings.Index(lastText, marker)
			if i < 0 {
				t.Error("missing read-image prompt")
				http.Error(w, "prompt", 400)
				return
			}
			args, _ := json.Marshal(map[string]string{"file_path": strings.TrimSpace(lastText[i+len(marker):])})
			calls := []any{}
			for j, id := range []string{"read_first", "read_second"} {
				calls = append(calls, map[string]any{"index": j, "id": id, "type": "function", "function": map[string]string{"name": "read_image", "arguments": string(args)}})
			}
			delta = map[string]any{"tool_calls": calls, "reasoning_content": "Read the local fixture twice."}
			reason = "tool_calls"
		} else if index != 5 {
			if count != 2 || len(toolIDs) != 2 || toolIDs[0] != "read_first" || toolIDs[1] != "read_second" {
				t.Errorf("images=%d toolIDs=%v", count, toolIDs)
			}
		} else {
			if count != 0 {
				t.Error("text model received image")
			}
			delta = map[string]any{"content": "TEXT_ONLY_OK"}
		}
		// A mismatched supplier response must fail without settling, even when
		// the request successfully uploaded and materialized historical images.
		responseModel := body.Model
		if index == 3 {
			responseModel = "unexpected-fixture-model"
		}
		chunk := map[string]any{"id": fmt.Sprintf("fixture-%d", index), "object": "chat.completion.chunk", "created": time.Now().Unix(), "model": responseModel, "choices": []any{map[string]any{"index": 0, "delta": delta, "finish_reason": reason}}, "usage": map[string]int{"prompt_tokens": 5, "completion_tokens": 1, "total_tokens": 6, "prompt_cache_hit_tokens": 2, "prompt_cache_miss_tokens": 3}}
		encoded, _ := json.Marshal(chunk)
		fmt.Fprintf(w, "data: %s\n\ndata: [DONE]\n\n", encoded)
	}))
	defer upstream.Close()
	for _, o := range []managedai.OfferingConfig{offering, vision} {
		capability := managedai.TextOnlyCapability()
		if o.PublicModelCode == vision.PublicModelCode {
			capability = deepSeekVisionCapability()
		}
		registry.(*providerRegistry).providers[strings.Join([]string{o.ProviderProfileKey, o.UpstreamModel, o.PublicModelCode}, "\x00")] = &capabilityBoundProvider{ModelProvider: deepseekhttp.NewBoundWithMedia("fixture", upstream.URL, o.UpstreamModel, o.PublicModelCode, 2, toolImageMedia{}), capability: capability}
	}
	assets := managedai.NewInputAssetService(store, objects, store, inputassetverify.New(objects, managedai.MaximumDecodedInputImagePixels))
	service := managedai.NewConfiguredServiceWithInputAssets(store, store, registry, assets)
	engine, e := managedaihttp.NewEngine(service, manager, managedaihttp.Options{AccessTokenSecret: liveAccessSecret, InternalRequestSecret: liveInternalSecret, MaxConcurrentStreams: 2})
	if e != nil {
		t.Fatal(e)
	}
	server := httptest.NewServer(engine)
	defer server.Close()
	command := exec.CommandContext(ctx, "pnpm", "exec", "vitest", "run", "--config", filepath.Join(plugin, "vitest.managed-ai-e2e.config.mts"))
	command.Dir = harness
	command.Env = append(os.Environ(), "ARKME_MANAGED_AI_ORIGIN="+server.URL)
	output, e := command.CombinedOutput()
	t.Logf("browser lane:\n%s", output)
	if e != nil {
		t.Fatal(e)
	}
	mu.Lock()
	actual := fmt.Sprint(positions)
	mu.Unlock()
	expectedPositions := []int{0, 2, 2, 2, 2, 0, 2}
	if actual != fmt.Sprint(expectedPositions) {
		t.Fatalf("provider image positions %s", actual)
	}
	var requests []struct {
		UID    string `db:"request_uid"`
		Status string `db:"status"`
		Base   int64  `db:"pricing_base_nano_cny"`
		Fee    int64  `db:"service_fee_nano_cny"`
		Charge int64  `db:"charged_nano_cny"`
	}
	if e = db.SelectContext(ctx, &requests, "SELECT request_uid,status,pricing_base_nano_cny,service_fee_nano_cny,charged_nano_cny FROM managed_ai_request WHERE user_id=42 ORDER BY id"); e != nil {
		t.Fatal(e)
	}
	if len(requests) != len(expectedPositions) {
		t.Fatalf("requests=%d", len(requests))
	}
	for i, row := range requests {
		expectedSettlements, expectedReleases := 1, 0
		if i == 3 {
			expectedSettlements, expectedReleases = 0, 1
			if row.Status != "failed" || row.Base != 0 || row.Fee != 0 || row.Charge != 0 {
				t.Fatalf("failed image request=%+v", row)
			}
		} else if row.Status != "succeeded" || row.Base != 14080 || row.Fee != 1408 || row.Charge != 15488 {
			t.Fatalf("successful image request=%+v", row)
		}
		var count int
		if e = db.GetContext(ctx, &count, "SELECT COUNT(*) FROM managed_ai_ledger WHERE request_uid=? AND entry_type='settle'", row.UID); e != nil || count != expectedSettlements {
			t.Fatalf("settlements=%d error=%v", count, e)
		}
		if e = db.GetContext(ctx, &count, "SELECT COUNT(*) FROM managed_ai_ledger WHERE request_uid=? AND entry_type='release'", row.UID); e != nil || count != expectedReleases {
			t.Fatalf("releases=%d error=%v", count, e)
		}
		var fact struct {
			Count  int `db:"input_image_count"`
			Unique int `db:"unique_input_image_count"`
		}
		if e = db.GetContext(ctx, &fact, "SELECT input_image_count,unique_input_image_count FROM managed_ai_request_execution_fact WHERE request_uid=?", row.UID); e != nil {
			t.Fatal(e)
		}
		expected := expectedPositions[i]
		unique := 0
		if expected > 0 {
			unique = 1
		}
		if fact.Count != expected || fact.Unique != unique {
			t.Fatalf("request %d image facts %+v", i, fact)
		}
		t.Logf("step=%d images=%d unique=%d base=%d fee=%d charge=%d settlements=%d releases=%d", i+1, fact.Count, fact.Unique, row.Base, row.Fee, row.Charge, expectedSettlements, expectedReleases)
	}
	balance, e := store.Balance(ctx, 42)
	if e != nil || balance.ReservedNanoCNY != 0 || balance.AvailableNanoCNY != 10_000_000_000-6*15488 {
		t.Fatalf("balance=%+v error=%v", balance, e)
	}
}
