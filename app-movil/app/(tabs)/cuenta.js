import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { colores, espaciado, radios } from '../../src/theme';
import { validarFormularioCuenta } from '../../src/utils/validacionCuenta';
import Card from '../../src/components/ui/Card';
import Button from '../../src/components/ui/Button';
import ProvisionalBanner from '../../src/components/ui/ProvisionalBanner';

export default function CuentaScreen() {
  const [modo, setModo] = useState('login');
  const [nombre, setNombre] = useState('');
  const [correo, setCorreo] = useState('');
  const [password, setPassword] = useState('');
  const [tocado, setTocado] = useState({});

  const { errores } = validarFormularioCuenta({
    modo,
    nombre,
    correo,
    password,
  });

  const esRegistro = modo === 'registro';

  const marcarTocado = (campo) => {
    setTocado((prev) => ({ ...prev, [campo]: true }));
  };

  return (
    <ScrollView
      style={styles.pantalla}
      contentContainerStyle={styles.contenido}
      keyboardShouldPersistTaps="handled"
    >
      <ProvisionalBanner
        titulo="Disponible pronto"
        descripcion="El registro e inicio de sesión de clientes estará activo cuando se conecte el módulo de cuentas (D-19)."
      />

      <View style={styles.selectorModo}>
        <Pressable
          onPress={() => setModo('login')}
          accessibilityRole="tab"
          accessibilityState={{ selected: !esRegistro }}
          style={[styles.tabBtn, !esRegistro && styles.tabBtnActivo]}
        >
          <Text style={[styles.tabTexto, !esRegistro && styles.tabTextoActivo]}>
            Iniciar sesión
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setModo('registro')}
          accessibilityRole="tab"
          accessibilityState={{ selected: esRegistro }}
          style={[styles.tabBtn, esRegistro && styles.tabBtnActivo]}
        >
          <Text style={[styles.tabTexto, esRegistro && styles.tabTextoActivo]}>
            Crear cuenta
          </Text>
        </Pressable>
      </View>

      <Card style={styles.formCard}>
        <Text style={styles.titulo}>
          {esRegistro ? 'REGISTRO DE CLIENTE' : 'BIENVENIDO DE NUEVO'}
        </Text>
        <Text style={styles.subtitulo}>
          {esRegistro
            ? 'Guarda tus direcciones y consulta tus pedidos anteriores.'
            : 'Ingresa con tu correo para pedir más rápido.'}
        </Text>

        {esRegistro && (
          <View style={styles.campo}>
            <Text style={styles.label}>NOMBRE COMPLETO</Text>
            <TextInput
              value={nombre}
              onChangeText={setNombre}
              onBlur={() => marcarTocado('nombre')}
              placeholder="Ej: Juan Buelvas"
              placeholderTextColor={colores.textoTenue}
              style={[
                styles.input,
                tocado.nombre && errores.nombre && styles.inputError,
              ]}
            />
            {tocado.nombre && errores.nombre ? (
              <Text style={styles.errorTexto}>{errores.nombre}</Text>
            ) : null}
          </View>
        )}

        <View style={styles.campo}>
          <Text style={styles.label}>CORREO ELECTRÓNICO</Text>
          <TextInput
            value={correo}
            onChangeText={setCorreo}
            onBlur={() => marcarTocado('correo')}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="correo@ejemplo.com"
            placeholderTextColor={colores.textoTenue}
            style={[
              styles.input,
              tocado.correo && errores.correo && styles.inputError,
            ]}
          />
          {tocado.correo && errores.correo ? (
            <Text style={styles.errorTexto}>{errores.correo}</Text>
          ) : null}
        </View>

        <View style={styles.campo}>
          <Text style={styles.label}>CONTRASEÑA</Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            onBlur={() => marcarTocado('password')}
            secureTextEntry
            placeholder="Mínimo 8 caracteres"
            placeholderTextColor={colores.textoTenue}
            style={[
              styles.input,
              tocado.password && errores.password && styles.inputError,
            ]}
          />
          {tocado.password && errores.password ? (
            <Text style={styles.errorTexto}>{errores.password}</Text>
          ) : null}
        </View>

        <Button disabled onPress={() => {}} style={styles.submitBtn}>
          {esRegistro
            ? 'Crear cuenta · Disponible pronto'
            : 'Iniciar sesión · Disponible pronto'}
        </Button>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pantalla: {
    flex: 1,
    backgroundColor: colores.fondo,
  },
  contenido: {
    padding: espaciado.lg,
    gap: espaciado.lg,
    paddingBottom: espaciado.xxl,
  },
  selectorModo: {
    flexDirection: 'row',
    backgroundColor: colores.superficie2,
    borderRadius: radios.md,
    borderWidth: 1,
    borderColor: colores.borde,
    padding: 4,
    gap: 4,
  },
  tabBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: radios.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBtnActivo: {
    backgroundColor: colores.primario,
  },
  tabTexto: {
    color: colores.textoSuave,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  tabTextoActivo: {
    color: colores.texto,
  },
  formCard: {
    gap: espaciado.md,
  },
  titulo: {
    color: colores.texto,
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  subtitulo: {
    color: colores.textoSuave,
    fontSize: 13,
    lineHeight: 19,
  },
  campo: {
    gap: 6,
  },
  label: {
    color: colores.textoSuave,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  input: {
    minHeight: 46,
    backgroundColor: colores.superficie2,
    borderWidth: 1,
    borderColor: colores.borde,
    borderRadius: radios.md,
    paddingHorizontal: espaciado.md,
    paddingVertical: espaciado.sm + 2,
    color: colores.texto,
    fontSize: 15,
  },
  inputError: {
    borderColor: colores.primarioTexto,
  },
  errorTexto: {
    color: colores.primarioTexto,
    fontSize: 12,
    fontWeight: '600',
  },
  submitBtn: {
    marginTop: espaciado.sm,
  },
});
