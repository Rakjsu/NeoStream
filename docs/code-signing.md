# Assinatura de código (Windows)

Hoje o instalador NSIS não é assinado (`signAndEditExecutable: false` no
`package.json`), então usuários novos veem o aviso do SmartScreen
("aplicativo não reconhecido"). Este guia documenta como habilitar a
assinatura quando houver um certificado.

## Opções de certificado

| Opção | Custo aprox. | Observações |
|---|---|---|
| **Azure Trusted Signing** (recomendado) | ~US$ 10/mês | Sem hardware, integra com electron-builder ≥ 25.1, reputação SmartScreen rápida |
| Certificado OV (Sectigo, Certum, etc.) | ~US$ 100–250/ano | Desde 2023 exige token físico (FIPS) ou HSM em nuvem |
| Certificado EV | ~US$ 250–450/ano | Reputação SmartScreen imediata; token físico obrigatório |

## Setup com Azure Trusted Signing

1. Criar conta no Azure e um recurso **Trusted Signing** (região East US é a mais barata).
2. Validar a identidade (pessoa física ou empresa) no portal — leva alguns dias.
3. Criar um *certificate profile* (Public Trust).
4. Criar um *service principal* com a role `Trusted Signing Certificate Profile Signer` e anotar `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`.
5. No `package.json` (`build.win`), remover `"sign": null` e `"signAndEditExecutable": false` e adicionar:

```json
"win": {
  "azureSignOptions": {
    "endpoint": "https://eus.codesigning.azure.net",
    "codeSigningAccountName": "<conta>",
    "certificateProfileName": "<perfil>"
  }
}
```

6. Exportar as credenciais como variáveis de ambiente antes do `electron-builder --win --publish always`:

```
AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET
```

7. `verifyUpdateCodeSignature` pode voltar a `true` depois que a primeira versão assinada estiver publicada (o updater valida que o novo binário tem o mesmo publisher).

## Setup com certificado OV/EV em token

1. Instalar o driver do token (SafeNet etc.) na máquina de build.
2. `package.json`:

```json
"win": {
  "certificateSubjectName": "<CN exato do certificado>",
  "signingHashAlgorithms": ["sha256"]
}
```

3. O electron-builder usa o `signtool.exe` do Windows SDK e pede o PIN do token a cada build (ou configurar o SafeNet para cache de PIN).

## Notas

- Assinar **não remove** o aviso imediatamente em certificados OV — a reputação SmartScreen é construída por volume de downloads. EV e Azure Trusted Signing têm reputação melhor de saída.
- O `latest.yml` do auto-update não precisa mudar; o electron-updater detecta a assinatura automaticamente.
- Nunca commitar credenciais — usar variáveis de ambiente ou GitHub Actions secrets.
