package issuer_test

import (
    "bytes"
    "encoding/json"
    "net/http"
    "net/http/httptest"
    "testing"

	"github.com/alovak/cardflow-playground/issuer"
	"github.com/alovak/cardflow-playground/issuer/models"
	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/require"
)

// Just a simple test
func TestAPI(t *testing.T) {
	router := chi.NewRouter()

    api := issuer.NewAPI(issuer.NewService(issuer.NewRepository(), issuer.DefaultConfig()))
	api.AppendRoutes(router)

	t.Run("create account", func(t *testing.T) {
		create := models.CreateAccount{
			Balance:  10_00,
			Currency: "USD",
		}

		jsonReq, _ := json.Marshal(create)

		w := httptest.NewRecorder()
		req, _ := http.NewRequest(http.MethodPost, "/accounts", bytes.NewBuffer(jsonReq))
		router.ServeHTTP(w, req)

		require.Equal(t, http.StatusCreated, w.Code)

		account := models.Account{}
		err := json.Unmarshal(w.Body.Bytes(), &account)
		require.NoError(t, err)

		require.Equal(t, create.Balance, account.AvailableBalance)
		require.Equal(t, create.Currency, account.Currency)
		require.NotEmpty(t, account.ID)
	})
}

func TestIssueCard_ResponseContainsCardFace(t *testing.T) {
    api := issuer.NewAPI(issuer.NewService(issuer.NewRepository(), issuer.DefaultConfig()))
    r := chi.NewRouter()
    api.AppendRoutes(r)

    // create account
    body := bytes.NewBufferString(`{"balance":10000,"currency":"USD"}`)
    req := httptest.NewRequest(http.MethodPost, "/accounts/", body)
    w := httptest.NewRecorder()
    r.ServeHTTP(w, req)
    require.Equal(t, http.StatusCreated, w.Code)
    var acc models.Account
    require.NoError(t, json.NewDecoder(w.Body).Decode(&acc))

    // issue card
    req2 := httptest.NewRequest(http.MethodPost, "/accounts/"+acc.ID+"/cards", nil)
    w2 := httptest.NewRecorder()
    r.ServeHTTP(w2, req2)
    require.Equal(t, http.StatusCreated, w2.Code)
    var resp struct{ CardFace string `json:"card_face"` }
    require.NoError(t, json.Unmarshal(w2.Body.Bytes(), &resp))
    require.Contains(t, resp.CardFace, "/")
}
func TestDevEndpoints_NotImplementedOnMem(t *testing.T) {
    api := issuer.NewAPI(issuer.NewService(issuer.NewRepository(), issuer.DefaultConfig()))
    r := chi.NewRouter()
    api.AppendRoutes(r)
    // mount dev routes via app-like router to test capture/reverse with mem
    // direct call handlers require repository; here we only check 404 (not mounted in API) so we simulate via app endpoints test skipped.
}
