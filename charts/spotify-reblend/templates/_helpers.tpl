{{/*
Expand the name of the chart.
*/}}
{{- define "spotify-reblend.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "spotify-reblend.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "spotify-reblend.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "spotify-reblend.labels" -}}
helm.sh/chart: {{ include "spotify-reblend.chart" . }}
{{ include "spotify-reblend.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "spotify-reblend.selectorLabels" -}}
app.kubernetes.io/name: {{ include "spotify-reblend.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "spotify-reblend.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "spotify-reblend.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Postgres Host
*/}}
{{- define "spotify-reblend.postgres.host" -}}
{{- if .Values.postgres.enabled }}
{{- printf "%s-postgres" (include "spotify-reblend.fullname" .) }}
{{- else }}
{{- .Values.externalPostgres.host }}
{{- end }}
{{- end }}

{{/*
Postgres Port
*/}}
{{- define "spotify-reblend.postgres.port" -}}
{{- if .Values.postgres.enabled }}
{{- .Values.postgres.service.port }}
{{- else }}
{{- .Values.externalPostgres.port }}
{{- end }}
{{- end }}

{{/*
Postgres User
*/}}
{{- define "spotify-reblend.postgres.user" -}}
{{- if .Values.postgres.enabled }}
{{- .Values.postgres.auth.username }}
{{- else }}
{{- .Values.externalPostgres.username }}
{{- end }}
{{- end }}

{{/*
Postgres Database
*/}}
{{- define "spotify-reblend.postgres.database" -}}
{{- if .Values.postgres.enabled }}
{{- .Values.postgres.auth.database }}
{{- else }}
{{- .Values.externalPostgres.database }}
{{- end }}
{{- end }}

{{/*
Postgres Secret Name
*/}}
{{- define "spotify-reblend.postgres.secretName" -}}
{{- if .Values.postgres.enabled }}
{{- default (include "spotify-reblend.fullname" .) .Values.postgres.auth.existingSecret }}
{{- else }}
{{- .Values.externalPostgres.auth.existingSecret }}
{{- end }}
{{- end }}

{{/*
Postgres Secret Key
*/}}
{{- define "spotify-reblend.postgres.secretKey" -}}
{{- if .Values.postgres.enabled }}
{{- default "POSTGRES_PASSWORD" .Values.postgres.auth.secretKey }}
{{- else }}
{{- default "password" .Values.externalPostgres.auth.secretKey }}
{{- end }}
{{- end }}
