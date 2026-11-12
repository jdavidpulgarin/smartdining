import { View, Text, StyleSheet } from 'react-native';
import { colores, radios, espaciado } from '../../theme';

export default function ProvisionalBanner({
  titulo = 'Disponible pronto',
  descripcion,
  variante = 'acento',
  style,
}) {
  const esDemo = variante === 'demo';
  const colorBorde = esDemo ? colores.primario : colores.acento;
  const colorTexto = esDemo ? colores.primarioTexto : colores.acento;

  return (
    <View
      accessibilityRole="text"
      style={[
        styles.banner,
        { borderColor: colorBorde },
        style,
      ]}
    >
      <Text style={[styles.titulo, { color: colorTexto }]}>{titulo}</Text>
      {descripcion ? (
        <Text style={styles.descripcion}>{descripcion}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colores.superficie2,
    borderRadius: radios.md,
    borderWidth: 1,
    paddingHorizontal: espaciado.md,
    paddingVertical: espaciado.sm + 2,
    gap: 2,
  },
  titulo: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  descripcion: {
    fontSize: 12,
    color: colores.textoSuave,
    lineHeight: 17,
  },
});
