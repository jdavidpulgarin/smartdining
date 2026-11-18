import { Pressable, Text, StyleSheet } from 'react-native';
import { colores, radios, espaciado } from '../../theme';

export default function Button({
  children,
  onPress,
  variante = 'primario',
  disabled = false,
  style,
  textStyle,
  accessibilityLabel,
}) {
  const esPrimario = variante === 'primario';

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || (typeof children === 'string' ? children : undefined)}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.base,
        esPrimario ? styles.primario : styles.secundario,
        pressed && !disabled && (esPrimario ? styles.primarioPressed : styles.secundarioPressed),
        disabled && styles.deshabilitado,
        style,
      ]}
    >
      <Text
        style={[
          styles.textoBase,
          esPrimario ? styles.textoPrimario : styles.textoSecundario,
          disabled && styles.textoDeshabilitado,
          textStyle,
        ]}
      >
        {children}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    borderRadius: radios.md,
    paddingHorizontal: espaciado.lg,
    paddingVertical: espaciado.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  primario: {
    backgroundColor: colores.primario,
  },
  primarioPressed: {
    backgroundColor: colores.primarioHover,
  },
  secundario: {
    backgroundColor: colores.superficie2,
    borderWidth: 1,
    borderColor: colores.borde,
  },
  secundarioPressed: {
    backgroundColor: colores.superficie,
  },
  deshabilitado: {
    opacity: 0.45,
  },
  textoBase: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  textoPrimario: {
    color: colores.texto,
  },
  textoSecundario: {
    color: colores.texto,
  },
  textoDeshabilitado: {
    color: colores.textoSuave,
  },
});
