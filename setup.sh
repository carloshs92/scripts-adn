#!/bin/bash

# Script de instalación rápida

echo "🚀 Iniciando instalación de PDF to CSV Converter..."
echo ""

# Verificar que Node.js está instalado
if ! command -v node &> /dev/null; then
    echo "❌ Node.js no está instalado"
    echo "   Descárgalo desde: https://nodejs.org/"
    exit 1
fi

echo "✅ Node.js detectado: $(node --version)"
echo ""

# Instalar dependencias
echo "📦 Instalando dependencias..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ Error instalando dependencias"
    exit 1
fi

echo "✅ Dependencias instaladas"
echo ""

# Crear directorios
echo "📁 Creando directorios..."
mkdir -p pdfs
mkdir -p output
echo "✅ Directorios creados"
echo ""

# Crear archivo .env si no existe
if [ ! -f .env ]; then
    echo "🔑 Creando archivo .env..."
    cp .env.example .env
    echo "⚠️  IMPORTANTE: Edita el archivo .env y añade tu OPENAI_API_KEY"
    echo ""
fi

echo "🎉 ¡Instalación completada!"
echo ""
echo "📖 Próximos pasos:"
echo "   1. Edita .env y añade tu OPENAI_API_KEY"
echo "   2. Coloca tus archivos PDF en la carpeta 'pdfs'"
echo "   3. Ejecuta: npm start"
echo ""
